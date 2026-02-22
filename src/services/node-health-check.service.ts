import { prisma } from "@/config/db";
import { clusterState } from "@/domain/cluster.state";
import { logger } from "@/libs/logger";

const HEARTBEAT_TIMEOUT_MS = parseInt(
  process.env.HEARTBEAT_TIMEOUT_MS || "90000",
  10,
);
const CHECK_INTERVAL_MS = parseInt(
  process.env.HEALTH_CHECK_INTERVAL_MS || "30000",
  10,
);

/**
 * Marks nodes as UNHEALTHY if lastHeartbeatAt is older than threshold.
 * Runs on an interval.
 */
async function checkNodeHealth(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
    const stale = await prisma.node.findMany({
      where: {
        status: { in: ["REGISTERED", "HEALTHY"] },
        OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null }],
      },
      select: { id: true },
    });

    for (const node of stale) {
      await prisma.node.update({
        where: { id: node.id },
        data: { status: "UNHEALTHY" },
      });
      clusterState.markUnhealthy(node.id);
      logger.info({ nodeId: node.id }, "Node marked UNHEALTHY (heartbeat timeout)");
    }
  } catch (err) {
    logger.error({ err }, "Node health check failed");
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startNodeHealthCheck(): void {
  if (intervalId) return;
  intervalId = setInterval(checkNodeHealth, CHECK_INTERVAL_MS);
  logger.info(
    { intervalMs: CHECK_INTERVAL_MS, timeoutMs: HEARTBEAT_TIMEOUT_MS },
    "Node health check started",
  );
}
