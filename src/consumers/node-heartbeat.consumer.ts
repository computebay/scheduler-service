import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

export async function startNodeHeartbeatConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.node.heartbeat", {
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

      // Update lastHeartbeatAt in Node table
      await prisma.node.update({
        where: { id: data.nodeId },
        data: {
          lastHeartbeatAt: new Date(),
          status: 'HEALTHY',
        },
      });

      clusterState.heartbeat(data.nodeId, data.usedCpu, data.usedMemoryMb);
      logger.debug({ nodeId: data.nodeId }, 'Processed node.heartbeat event');

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing node.heartbeat message');
    }
  });
}
