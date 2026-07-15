import { clusterState } from "./cluster.state";
import { leastAllocatedFit } from "./placement.algorithm";
import { publishJobScheduled } from "../producers/scheduler.events";
import { prisma } from "@/config/db";
import { getLogger, schedulingLatency, instrumentedQuery } from "@computebay/observability";

const logger = getLogger();

/** Ensures only one job runs "getEligible + reserve" at a time so we don't over-assign the same node. */
let schedulingLock: Promise<void> = Promise.resolve();

export interface JobCreatedEvent {
  jobId: string;
  orgId: string;
  resources: { cpu: number; memoryMB: number };
  [key: string]: unknown;
}

export async function scheduleJob(event: JobCreatedEvent) {
  const release = await acquireSchedulingLock();
  const { jobId, resources } = event;
  const startTime = Date.now();

  try {
    const eligible = clusterState.getEligible(
      resources.cpu,
      resources.memoryMB,
    );

    logger.debug(
      { jobId, eligibleCount: eligible.length },
      "Found eligible nodes for scheduling",
    );

    const selected = leastAllocatedFit(eligible);

    if (!selected) {
      await instrumentedQuery("INSERT", "scheduling_audit", "scheduler-service", () =>
        prisma.schedulingAudit.create({
          data: {
            jobId,
            nodeId: "",
            decision: "REJECTED_NO_CAPACITY",
          },
        }),
      );
      logger.info({ jobId }, "Job rejected: no capacity");
      return;
    }

    clusterState.reserve(
      selected.nodeId,
      event.resources.cpu,
      event.resources.memoryMB,
    );

    const schedulingDuration = (Date.now() - startTime) / 1000;
    schedulingLatency.observe({ service: "scheduler-service" }, schedulingDuration);

    logger.info(
      { jobId, nodeId: selected.nodeId, scheduling_duration_ms: Date.now() - startTime },
      "Job scheduled",
    );

    await instrumentedQuery("INSERT", "scheduling_audit", "scheduler-service", () =>
      prisma.schedulingAudit.create({
        data: {
          jobId,
          nodeId: selected.nodeId,
          decision: "SCHEDULED",
        },
      }),
    );

    await publishJobScheduled(event, selected.nodeId);
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
