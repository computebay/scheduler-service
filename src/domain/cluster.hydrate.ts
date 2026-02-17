import { prisma } from "@/config/db";
import { clusterState } from "./cluster.state";
import { logger } from "../libs/logger";

/** Load REGISTERED/HEALTHY nodes from DB into in-memory cluster state (e.g. after scheduler restart). */
export async function hydrateClusterFromDb(): Promise<void> {
  try {
    const nodes = await prisma.node.findMany({
      where: { status: { in: ["REGISTERED", "HEALTHY"] } },
      select: { id: true, totalCpu: true, totalMemoryMb: true },
    });

    for (const node of nodes) {
      clusterState.register({
        nodeId: node.id,
        totalCpu: node.totalCpu,
        totalMemoryMb: node.totalMemoryMb,
        usedCpu: 0,
        usedMemoryMb: 0,
        healthy: true,
        lastHeartbeat: Date.now(),
      });
    }

    if (nodes.length > 0) {
      logger.info(
        { count: nodes.length, clusterSize: clusterState.size() },
        "Hydrated cluster state from DB",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to hydrate cluster state from DB");
  }
}
