import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";

export async function startNodeHeartbeatConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.node.heartbeat", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.node.heartbeat",
    "computebay",
    "node.heartbeat"
  );

  channel.consume("scheduler.node.heartbeat", (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    clusterState.heartbeat(
      data.nodeId,
      data.usedCpu,
      data.usedMemoryMb
    );

    channel.ack(msg);
  });
}
