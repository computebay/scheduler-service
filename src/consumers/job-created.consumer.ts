import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";

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

    const data = JSON.parse(msg.content.toString());

    await scheduleJob(data);

    channel.ack(msg);
  });
}
