import { clusterState } from "./cluster.state";
import { leastAllocatedFit } from "./placement.algorithm";
import { publishJobScheduled } from "../producers/scheduler.events";
import { prisma } from "../libs/prisma";

export async function scheduleJob(event: {
  jobId: string;
  orgId: string;
  resources: { cpu: number; memory: number };
}) {
  const eligible = clusterState.getEligible(
    event.resources.cpu,
    event.resources.memory
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
    return;
  }

  clusterState.reserve(
    selected.nodeId,
    event.resources.cpu,
    event.resources.memory
  );

  await prisma.schedulingAudit.create({
    data: {
      jobId: event.jobId,
      nodeId: selected.nodeId,
      decision: "SCHEDULED",
    },
  });

  await publishJobScheduled(event.jobId, selected.nodeId);
}
