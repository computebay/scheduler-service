import { clusterState } from "./cluster.state";
import { leastAllocatedFit } from "./placement.algorithm";
import { publishJobScheduled } from "../producers/scheduler.events";
import { prisma } from "@/config/db";
import { getLogger, schedulingLatency, instrumentedQuery } from "@computebay/observability";
import {
  parseGpuRequirement,
  type GpuRequirement,
} from "./gpu.types";
import {
  planNodeGpuAllocation,
  toGpuAssignment,
} from "./gpu.scheduling";
import {
  persistGpuAllocation,
} from "@/services/gpu-allocation.service";
import { releaseGpuAllocation } from "./gpu.release";
import type { GpuAllocationRecord, GpuPlanFailure } from "./gpu.types";

const logger = getLogger();

/** Ensures only one job runs "getEligible + reserve" at a time so we don't over-assign the same node. */
let schedulingLock: Promise<void> = Promise.resolve();

export interface JobCreatedEvent {
  jobId: string;
  orgId: string;
  resources: {
    cpu: number;
    memoryMB: number;
    /** Optional GPU requirement; legacy "any"/"none" values are normalized. */
    gpu?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function auditRejection(jobId: string, reason?: string): Promise<void> {
  await instrumentedQuery("INSERT", "scheduling_audit", "scheduler-service", () =>
    prisma.schedulingAudit.create({
      data: {
        jobId,
        nodeId: "",
        decision: "REJECTED_NO_CAPACITY",
        ...(reason ? { reason } : {}),
      },
    }),
  );
}

/** Prefer the most actionable GPU failure when no node can satisfy the job. */
const FAILURE_PRIORITY: Record<GpuPlanFailure["code"], number> = {
  GPU_VENDOR_UNSUPPORTED: 0,
  GPU_BACKEND_UNSUPPORTED: 1,
  GPU_EXECUTION_UNVERIFIED: 2,
  GPU_VRAM_INSUFFICIENT: 3,
  GPU_HARDWARE_MISSING: 4,
  GPU_CAPACITY_EXHAUSTED: 5,
  GPU_REQUIREMENT_INVALID: 6,
};

function betterFailure(
  current: GpuPlanFailure | undefined,
  next: GpuPlanFailure | undefined
): GpuPlanFailure | undefined {
  if (!next) return current;
  if (!current) return next;
  return FAILURE_PRIORITY[next.code] < FAILURE_PRIORITY[current.code]
    ? next
    : current;
}

function findGpuPlan(
  jobId: string,
  requirement: GpuRequirement,
  eligible: ReturnType<typeof clusterState.getEligible>
): {
  selected: ReturnType<typeof leastAllocatedFit>;
  allocation: GpuAllocationRecord | null;
  failure?: GpuPlanFailure;
} {
  const candidates: typeof eligible = [];
  let failure: GpuPlanFailure | undefined;

  for (const node of eligible) {
    const plan = planNodeGpuAllocation(
      node,
      jobId,
      requirement,
      clusterState.getReservedGpuKeys(node.nodeId),
    );
    if (plan.allocation) {
      candidates.push(node);
    } else {
      failure = betterFailure(failure, plan.failure);
    }
  }

  if (candidates.length === 0) {
    return { selected: null, allocation: null, failure };
  }

  const selected = leastAllocatedFit(candidates);
  if (!selected) {
    return { selected: null, allocation: null, failure };
  }

  // Re-plan against the selected node so the returned allocation belongs to it.
  const plan = planNodeGpuAllocation(
    selected,
    jobId,
    requirement,
    clusterState.getReservedGpuKeys(selected.nodeId),
  );
  return {
    selected: plan.allocation ? selected : null,
    allocation: plan.allocation,
    failure: plan.allocation ? undefined : betterFailure(failure, plan.failure),
  };
}

export async function scheduleJob(event: JobCreatedEvent) {
  const release = await acquireSchedulingLock();
  const { jobId, resources } = event;
  const startTime = Date.now();

  try {
    const { requirement, error: requirementError } = parseGpuRequirement(
      resources.gpu,
    );
    if (requirementError) {
      logger.warn(
        { jobId, reason: requirementError },
        "Job rejected: invalid GPU requirement",
      );
      await auditRejection(
        jobId,
        `GPU_REQUIREMENT_INVALID: ${requirementError}`,
      );
      return;
    }

    if (requirement) {
      // A redelivered job.created must not allocate a second set of devices.
      const existing = clusterState.getGpuAllocation(jobId);
      if (existing) {
        if (clusterState.isHealthy(existing.nodeId)) {
          logger.info(
            { jobId, nodeId: existing.nodeId },
            "Duplicate GPU job delivery; reusing existing allocation",
          );
          await publishJobScheduled(
            event,
            existing.nodeId,
            toGpuAssignment(existing),
          );
          return;
        }
        await releaseGpuAllocation(jobId, "node_unavailable_on_redelivery");
      }
    }

    const eligible = clusterState.getEligible(
      resources.cpu,
      resources.memoryMB,
    );

    logger.debug(
      { jobId, eligibleCount: eligible.length, gpu: Boolean(requirement) },
      "Found eligible nodes for scheduling",
    );

    let selected: ReturnType<typeof leastAllocatedFit> = null;
    let allocation: GpuAllocationRecord | null = null;
    let gpuFailure: GpuPlanFailure | undefined;

    if (requirement) {
      const plan = findGpuPlan(jobId, requirement, eligible);
      selected = plan.selected;
      allocation = plan.allocation;
      gpuFailure = plan.failure;
    } else {
      selected = leastAllocatedFit(eligible);
    }

    if (!selected) {
      const reason = requirement
        ? gpuFailure
          ? `${gpuFailure.code}: ${gpuFailure.message}`
          : "GPU_CAPACITY_EXHAUSTED: no eligible GPU node"
        : "CPU_OR_MEMORY_EXHAUSTED: no node has enough capacity";
      await auditRejection(jobId, reason);
      logger.info({ jobId, reason }, "Job rejected: no capacity");
      return;
    }

    const scheduledNodeId = selected.nodeId;
    clusterState.reserve(
      scheduledNodeId,
      event.resources.cpu,
      event.resources.memoryMB,
    );

    if (allocation) {
      try {
        await persistGpuAllocation(allocation);
        clusterState.reserveGpuAllocation(allocation);
      } catch (err) {
        clusterState.release(
          scheduledNodeId,
          event.resources.cpu,
          event.resources.memoryMB,
        );
        throw err;
      }
    }

    const schedulingDuration = (Date.now() - startTime) / 1000;
    schedulingLatency.observe({ service: "scheduler-service" }, schedulingDuration);

    logger.info(
      {
        jobId,
        nodeId: scheduledNodeId,
        gpuDevices: allocation?.devices.map((device) => device.index),
        scheduling_duration_ms: Date.now() - startTime,
      },
      "Job scheduled",
    );

    await instrumentedQuery("INSERT", "scheduling_audit", "scheduler-service", () =>
      prisma.schedulingAudit.create({
        data: {
          jobId,
          nodeId: scheduledNodeId,
          decision: "SCHEDULED",
          ...(allocation
            ? { reason: `GPU ${allocation.vendor}/${allocation.backend} x${allocation.count}` }
            : {}),
        },
      }),
    );

    await publishJobScheduled(
      event,
      scheduledNodeId,
      allocation ? toGpuAssignment(allocation) : undefined,
    );
  } finally {
    release();
  }
}

async function acquireSchedulingLock(): Promise<() => void> {
  const prev = schedulingLock;
  let release: () => void;
  schedulingLock = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return prev.then(() => release!);
}
