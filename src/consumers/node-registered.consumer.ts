import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";

export async function startNodeRegisteredConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.node.registered", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.node.registered",
    "computebay",
    "node.registered"
  );

  channel.consume("scheduler.node.registered", (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    clusterState.register({
      nodeId: data.nodeId,
      totalCpu: data.totalCpu,
      totalMemoryMb: data.totalMemoryMb,
      usedCpu: 0,
      usedMemoryMb: 0,
      healthy: true,
      lastHeartbeat: Date.now(),
    });

    channel.ack(msg);
  });
}
