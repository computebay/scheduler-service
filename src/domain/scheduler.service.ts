import { clusterState } from "./cluster.state";
import { leastAllocatedFit } from "./placement.algorithm";
import { publishJobScheduled } from "../producers/scheduler.events";
import { prisma } from "@/config/db";
import { logger } from "../libs/logger";

/** Ensures only one job runs "getEligible + reserve" at a time so we don't over-assign the same node. */
let schedulingLock: Promise<void> = Promise.resolve();

export async function scheduleJob(event: {
  jobId: string;
  orgId: string;
  resources: { cpu: number; memoryMB: number };
}) {
  const release = await acquireSchedulingLock();

  try {
    const eligible = clusterState.getEligible(
      event.resources.cpu,
      event.resources.memoryMB
    );

    logger.debug(
      { jobId: event.jobId, eligibleCount: eligible.length },
      "Found eligible nodes for scheduling"
    );

    const selected = leastAllocatedFit(eligible);

    if (!selected) {
      await prisma.schedulingAudit.create({
        data: {
          jobId: event.jobId,
          nodeId: "",
          decision: "REJECTED_NO_CAPACITY",
        },
      });
      logger.info({ jobId: event.jobId }, "Job rejected: no capacity");
      return;
    }

    clusterState.reserve(
      selected.nodeId,
      event.resources.cpu,
      event.resources.memoryMB
    );

    logger.info({ jobId: event.jobId, nodeId: selected.nodeId }, "Job scheduled");

    await prisma.schedulingAudit.create({
      data: {
        jobId: event.jobId,
        nodeId: selected.nodeId,
        decision: "SCHEDULED",
      },
    });

    await publishJobScheduled(event.jobId, selected.nodeId);
  } finally {
    release();
  }
}

function acquireSchedulingLock(): Promise<() => void> {
  const prev = schedulingLock;
  let release: () => void;
  schedulingLock = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return prev.then(() => release!);
}
