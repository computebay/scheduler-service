import { getChannel } from "../config/rabbitmq";
import type { JobCreatedEvent } from "../domain/scheduler.service";

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
  channel.sendToQueue(
    queue,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true },
  );
}

export interface NodeRegisteredEvent {
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

  channel.publish(
    "compute-bay.jobs",
    "node.registered",
    Buffer.from(JSON.stringify(payload)),
    { persistent: true },
  );
}
