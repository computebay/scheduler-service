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

  channel.sendToQueue(
    `queue.node.${nodeId}`,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true },
  );
}
