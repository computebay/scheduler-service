import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "../domain/cluster.state";
import { logger } from "../libs/logger";
import { prisma } from "@/config/db";

export async function startNodeRegisteredConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.events", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.events",
    "compute-bay.jobs",
    "node.registered"
  );

  channel.consume("scheduler.events", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const nodeId = data.nodeId ?? data.id;

      if (!nodeId || typeof nodeId !== 'string') {
        logger.warn({ data, keys: Object.keys(data || {}) }, 'node.registered missing nodeId/id – skipping');
        channel.ack(msg);
        return;
      }

      const orgId = data.orgId ?? data.org_id ?? '';
      const name = data.name ?? nodeId;
      if (!orgId) {
        logger.warn({ nodeId, data }, 'node.registered missing orgId – skipping create');
        channel.ack(msg);
        return;
      }
      const totalCpu = Number(data.totalCpu) || 0;
      const totalMemoryMb = Number(data.totalMemoryMb) || 0;

      // Insert into Node table
      await prisma.node.upsert({
        where: { id: nodeId },
        update: {
          status: 'REGISTERED',
          lastHeartbeatAt: new Date(),
        },
        create: {
          id: nodeId,
          orgId,
          name,
          region: data.region ?? null,
          totalCpu,
          totalMemoryMb,
          status: 'REGISTERED',
          lastHeartbeatAt: new Date(),
        },
      });

      clusterState.register({
        nodeId,
        totalCpu,
        totalMemoryMb,
        usedCpu: 0,
        usedMemoryMb: 0,
        healthy: true,
        lastHeartbeat: Date.now(),
      });

      logger.info({ nodeId }, 'Node registered');
      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing node.registered message');
    }
  });
}
