import { getChannel } from "../config/rabbitmq";
import type { JobCreatedEvent } from "../domain/scheduler.service";
import type { GpuSummary } from "../utils/gpu";
import { instrumentedSendToQueue, instrumentedPublish, getLogger } from "@computebay/observability";

const logger = getLogger();

/** Forwards full job payload so the worker has jobType, runtime, entrypoint, inputArtifacts, etc. */
export async function publishJobScheduled(event: JobCreatedEvent, nodeId: string) {
  const channel = getChannel();

  const payload = {
    ...event,
    nodeId,
    scheduledAt: Date.now(),
  };

  const queue = `queue.node.${nodeId}`;
  await channel.assertQueue(queue, { durable: true });

  instrumentedSendToQueue(channel, queue, Buffer.from(JSON.stringify(payload)), "scheduler-service", {
    persistent: true,
  });
}

export interface NodeRegisteredEvent extends GpuSummary {
  nodeId: string;
  machineId: string;
  agentVersion: string;
  totalCpu: number;
  totalMemoryMb: number;
  allocatableCpu: number;
  allocatableMemoryMb: number;
  queue: string;
  publishExchange: string;
  eventsExchange: string;
}

/** Emits node.registered so downstream services (e.g. job-service) can react to new workers. */
export async function publishNodeRegistered(event: NodeRegisteredEvent) {
  const channel = getChannel();

  const payload = {
    ...event,
    registeredAt: Date.now(),
  };

  instrumentedPublish(channel, {
    exchange: "compute-bay.jobs",
    routingKey: "node.registered",
    service: "scheduler-service",
  }, Buffer.from(JSON.stringify(payload)));
}
