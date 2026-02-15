import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

/** Process a node.registered message payload. Called by the single scheduler.events consumer. */
export async function processNodeRegistered(data: Record<string, unknown>): Promise<void> {
  const nodeId = (data.nodeId ?? data.id) as string | undefined;
  if (!nodeId || typeof nodeId !== "string") {
    logger.warn({ data, keys: Object.keys(data || {}) }, "node.registered missing nodeId/id – skipping");
    return;
  }

  const orgId = (data.orgId ?? data.org_id ?? "") as string;
  const name = (data.name ?? nodeId) as string;
  const totalCpu = Number(data.totalCpu) || 0;
  const totalMemoryMb = Number(data.totalMemoryMb) || 0;

  if (orgId) {
    await prisma.node.upsert({
      where: { id: nodeId },
      update: {
        status: "REGISTERED",
        lastHeartbeatAt: new Date(),
      },
      create: {
        id: nodeId,
        orgId,
        name,
        region: (data.region as string) ?? null,
        totalCpu,
        totalMemoryMb,
        status: "REGISTERED",
        lastHeartbeatAt: new Date(),
      },
    });
  } else {
    const existing = await prisma.node.findUnique({ where: { id: nodeId } });
    if (existing) {
      await prisma.node.update({
        where: { id: nodeId },
        data: { status: "REGISTERED", lastHeartbeatAt: new Date() },
      });
      clusterState.register({
        nodeId,
        totalCpu: existing.totalCpu,
        totalMemoryMb: existing.totalMemoryMb,
        usedCpu: 0,
        usedMemoryMb: 0,
        healthy: true,
        lastHeartbeat: Date.now(),
      });
      logger.debug({ nodeId }, "Node re-registered (update only, no orgId in payload)");
      return;
    }
    logger.warn({ nodeId, data }, "node.registered missing orgId and node not in DB – skipping");
    return;
  }

  clusterState.register({
    nodeId,
    totalCpu,
    totalMemoryMb,
    usedCpu: 0,
    usedMemoryMb: 0,
    healthy: true,
    lastHeartbeat: Date.now(),
  });
  logger.info({ nodeId }, "Node registered");
}

/** No-op: bindings and consume are done in job-created.consumer (single consumer). */
export async function startNodeRegisteredConsumer() {
  // Queue binding and consumption are in startSchedulerConsumer()
}
