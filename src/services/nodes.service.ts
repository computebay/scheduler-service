import { prisma } from "@/config/db";
import { env } from "@/config/env";
import { getChannel } from "@/config/rabbitmq";
import { clusterState } from "@/domain/cluster.state";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import { setRabbitMqPermissions, upsertRabbitMqUser } from "@/integrations/rabbitmq/rabbitmq-management";
import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { publishNodeRegistered } from "@/producers/scheduler.events";

const logger = getLogger();

type RegisterNodeInput = {
  machineId: string;
  cpuCores: number;
  memoryMB: number;
  agentVersion: string;
};

type HeartbeatNodeInput = {
  nodeId: string;
  availableCpu: number;
  availableMemoryMB: number;
};

function generatePassword(): string {
  return randomBytes(32).toString("base64url");
}

function buildScopedAmqpUrl(username: string, password: string): string {
  const base = env.rabbitmq.url || Bun.env.RABBITMQ_URL || "";
  if (!base) throw new Error("RABBITMQ_URL is not configured");

  const u = new URL(base);
  u.username = username;
  u.password = password;
  return u.toString();
}

export const nodesService = {
  async register(input: RegisterNodeInput) {
    const nodeId = uuidv4();

    await instrumentedQuery("INSERT", "nodes", "scheduler-service", () =>
      prisma.node.create({
        data: {
          id: nodeId,
          orgId: "default",
          name: input.machineId,
          status: "REGISTERED",
          machineId: input.machineId,
          agentVersion: input.agentVersion,
          totalCpu: input.cpuCores,
          totalMemoryMb: input.memoryMB,
          allocatableCpu: input.cpuCores,
          allocatableMemoryMb: input.memoryMB,
          lastHeartbeatAt: new Date(),
        },
      }),
    );

    const queue = `queue.node.${nodeId}`;
    const eventsExchange = `node.${nodeId}.events`;
    const channel = getChannel();
    await channel.assertQueue(queue, { durable: true });
    // Priority stop lane — declared here (admin creds); workers only read it.
    await channel.assertQueue(`${queue}.cancel`, { durable: true });
    await channel.assertExchange(eventsExchange, "topic", { durable: true });

    // Per-node broker credentials
    const username = `node_${nodeId}`;
    const password = generatePassword();

    // Create/rotate user and scope permissions.
    await upsertRabbitMqUser(username, password);
    await setRabbitMqPermissions(username, env.rabbitmq.vhost || "/", {
      configure: "",
      write: `^(node\\.events|node\\.${nodeId}\\.events)$`,
      read: `^queue\\.node\\.${nodeId}(\\.cancel)?$`,
    });

    // Make node schedulable immediately
    clusterState.register({
      nodeId,
      totalCpu: input.cpuCores,
      totalMemoryMb: input.memoryMB,
      usedCpu: 0,
      usedMemoryMb: 0,
      healthy: true,
      lastHeartbeat: Date.now(),
    });

    logger.info({ nodeId, machineId: input.machineId }, "Registered node via HTTP");

    // Notify internal consumers (e.g. job-service) that a new node is available.
    await publishNodeRegistered({
      nodeId,
      machineId: input.machineId,
      agentVersion: input.agentVersion,
      totalCpu: input.cpuCores,
      totalMemoryMb: input.memoryMB,
      allocatableCpu: input.cpuCores,
      allocatableMemoryMb: input.memoryMB,
      queue,
      publishExchange: "node.events",
      eventsExchange,
    });

    return {
      nodeId,
      rabbitmq: {
        url: buildScopedAmqpUrl(username, password),
        queue,
        publishExchange: "node.events",
      },
    };
  },

  async heartbeat(input: HeartbeatNodeInput) {
    const node = await instrumentedQuery("SELECT", "nodes", "scheduler-service", () =>
      prisma.node.findUnique({
        where: { id: input.nodeId },
        select: {
          id: true,
          allocatableCpu: true,
          allocatableMemoryMb: true,
          totalCpu: true,
          totalMemoryMb: true,
        },
      }),
    );

    if (!node) {
      logger.warn({ nodeId: input.nodeId }, "HTTP heartbeat for unknown node");
      return;
    }

    const totalCpu = node.allocatableCpu ?? node.totalCpu;
    const totalMemoryMb = node.allocatableMemoryMb ?? node.totalMemoryMb;
    const usedCpu = Math.max(0, totalCpu - input.availableCpu);
    const usedMemoryMb = Math.max(0, totalMemoryMb - input.availableMemoryMB);

    await instrumentedQuery("UPDATE", "nodes", "scheduler-service", () =>
      prisma.node.update({
        where: { id: input.nodeId },
        data: {
          lastHeartbeatAt: new Date(),
          status: "HEALTHY",
        },
      }),
    );

    clusterState.heartbeat(input.nodeId, usedCpu, usedMemoryMb);
  },
};
