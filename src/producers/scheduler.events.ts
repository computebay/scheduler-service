import { getChannel } from "../config/rabbitmq";

export async function publishJobScheduled(
  jobId: string,
  nodeId: string
) {
  const channel = getChannel();

  channel.publish(
    "computebay",
    "job.scheduled",
    Buffer.from(
      JSON.stringify({
        jobId,
        nodeId,
        scheduledAt: Date.now(),
      })
    ),
    { persistent: true }
  );
}
