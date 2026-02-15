import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

export async function startNodeHeartbeatConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.events", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.events",
    "compute-bay.jobs",
    "node.heartbeat"
  );

  channel.consume("scheduler.events", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const nodeId = data.nodeId ?? data.id;

      if (!nodeId || typeof nodeId !== 'string') {
        logger.warn({ data, keys: Object.keys(data || {}) }, 'node.heartbeat missing nodeId/id – skipping');
        channel.ack(msg);
        return;
      }

      // Update lastHeartbeatAt in Node table
      await prisma.node.update({
        where: { id: nodeId },
        data: {
          lastHeartbeatAt: new Date(),
          status: 'HEALTHY',
        },
      });

      clusterState.heartbeat(nodeId, data.usedCpu ?? 0, data.usedMemoryMb ?? 0);
      logger.debug({ nodeId }, 'Processed node.heartbeat event');

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing node.heartbeat message');
    }
  });
}
