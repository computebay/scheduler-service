import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

/** Process a node.heartbeat message payload. Called by the single scheduler.events consumer. */
export async function processNodeHeartbeat(data: Record<string, unknown>): Promise<void> {
  const nodeId = (data.nodeId ?? data.id) as string | undefined;
  if (!nodeId || typeof nodeId !== "string") {
    logger.warn({ data, keys: Object.keys(data || {}) }, "node.heartbeat missing nodeId/id – skipping");
    return;
  }

  try {
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        lastHeartbeatAt: new Date(),
        status: "HEALTHY",
      },
    });
  } catch {
    // Node may not exist yet (e.g. heartbeat before register)
    logger.debug({ nodeId }, "node.heartbeat: node not in DB, skipping DB update");
  }

  clusterState.heartbeat(
    nodeId,
    Number(data.usedCpu) || 0,
    Number(data.usedMemoryMb) || 0
  );
  logger.debug({ nodeId }, "Processed node.heartbeat event");
}

/** No-op: bindings and consume are done in job-created.consumer (single consumer). */
export async function startNodeHeartbeatConsumer() {
  // Queue binding and consumption are in startSchedulerConsumer()
}
