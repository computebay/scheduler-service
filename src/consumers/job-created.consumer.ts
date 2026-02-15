import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";
import { logger } from "../libs/logger";

export async function startJobCreatedConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.job.created", {
    durable: true,
  });

  await channel.bindQueue(
    "scheduler.job.created",
    "computebay",
    "job.created"
  );

  channel.consume("scheduler.job.created", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      logger.debug({ jobId: data.jobId }, 'Received job.created event');

      await scheduleJob(data);

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Error processing job.created message');
      // don't ack so message can be retried or moved to DLQ depending on broker setup
    }
  });
}
