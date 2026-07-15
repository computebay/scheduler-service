import { clusterState } from "../domain/cluster.state";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import { prisma } from "@/config/db";
import { verifyWorkerMessage } from "../security/signature.verify";

const logger = getLogger();

export async function processNodeHeartbeat(
  data: Record<string, unknown>,
): Promise<void> {
  const nodeId = (data.nodeId ?? data.id) as string | undefined;
  if (!nodeId || typeof nodeId !== "string") {
    logger.warn(
      { data, keys: Object.keys(data || {}) },
      "node.heartbeat missing nodeId – skipping",
    );
    return;
  }

  const node = await instrumentedQuery("SELECT", "nodes", "scheduler-service", () =>
    prisma.node.findUnique({
      where: { id: nodeId },
      select: { publicKey: true },
    }),
  );

  if (!node) {
    logger.warn({ nodeId }, "node.heartbeat: node not in DB – skipping");
    return;
  }

  // If node has publicKey, verify signature
  if (node.publicKey && data.signature) {
    const valid = await verifyWorkerMessage(nodeId, data);
    if (!valid) return;
  }

  await instrumentedQuery("UPDATE", "nodes", "scheduler-service", () =>
    prisma.node.update({
      where: { id: nodeId },
      data: {
        lastHeartbeatAt: new Date(),
        status: "HEALTHY",
      },
    }),
  );

  clusterState.heartbeat(
    nodeId,
    Number(data.usedCpu) || 0,
    Number(data.usedMemoryMb) || 0,
  );

  logger.debug({ nodeId }, "Processed node.heartbeat");
}
