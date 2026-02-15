import { getChannel } from "../config/rabbitmq";

export async function publishJobScheduled(
  jobId: string,
  nodeId: string
) {
  const channel = getChannel();
  
  await channel.bindQueue(
    "scheduler.job.scheduled",
    "compute-bay.jobs",
    "job.job_scheduled"
  );
  
  channel.publish(
    "compute-bay.jobs",
    "job.job_scheduled",
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
