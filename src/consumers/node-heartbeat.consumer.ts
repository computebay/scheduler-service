import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";

export async function startNodeHeartbeatConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.node.heartbeat", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.node.heartbeat",
    "compute-bay.jobs",
    "node.heartbeat"
  );

  channel.consume("scheduler.node.heartbeat", (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());

      clusterState.heartbeat(data.nodeId, data.usedCpu, data.usedMemoryMb);
      logger.debug({ nodeId: data.nodeId }, 'Processed node.heartbeat event');

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing node.heartbeat message');
    }
  });
}
