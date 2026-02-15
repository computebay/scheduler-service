import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

export async function startNodeRegisteredConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.node.registered", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.node.registered",
    "compute-bay.jobs",
    "node.registered"
  );

  channel.consume("scheduler.node.registered", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());

      // Insert into Node table
      await prisma.node.upsert({
        where: { id: data.nodeId },
        update: {
          status: 'REGISTERED',
          lastHeartbeatAt: new Date(),
        },
        create: {
          id: data.nodeId,
          orgId: data.orgId,
          name: data.name || data.nodeId,
          region: data.region,
          totalCpu: data.totalCpu,
          totalMemoryMb: data.totalMemoryMb,
          status: 'REGISTERED',
          lastHeartbeatAt: new Date(),
        },
      });

      clusterState.register({
        nodeId: data.nodeId,
        totalCpu: data.totalCpu,
        totalMemoryMb: data.totalMemoryMb,
        usedCpu: 0,
        usedMemoryMb: 0,
        healthy: true,
        lastHeartbeat: Date.now(),
      });

      logger.info({ nodeId: data.nodeId }, 'Node registered');
      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing node.registered message');
    }
  });
}
