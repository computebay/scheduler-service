import { getChannel } from "../config/rabbitmq";

/** Publishes with routing key `job.scheduled.${nodeId}`. For job-service to receive these, bind its queue to exchange "compute-bay.jobs" with pattern `job.scheduled.#`. */
export async function publishJobScheduled(
  jobId: string,
  nodeId: string
) {
  const channel = getChannel();

  channel.publish(
    "compute-bay.jobs",
    `job.scheduled.${nodeId}`,
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


