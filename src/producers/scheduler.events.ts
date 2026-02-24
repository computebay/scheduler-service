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
