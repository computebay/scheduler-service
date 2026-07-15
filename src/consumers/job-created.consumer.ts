import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";
import { processNodeHeartbeat } from "@/consumers/node-heartbeat.consumer";
import { processNodeRegistered } from "@/consumers/node-registered.consumer";
import { getLogger, instrumentedHandler } from "@computebay/observability";

const logger = getLogger();

export async function startSchedulerConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.events", {
    durable: true,
  });

  await channel.bindQueue("scheduler.events", "compute-bay.jobs", "job.created");
  await channel.bindQueue(
    "scheduler.events",
    "compute-bay.jobs",
    "node.registration.requested",
  );
  await channel.bindQueue("scheduler.events", "compute-bay.jobs", "node.registered");
  await channel.bindQueue("scheduler.events", "compute-bay.jobs", "node.heartbeat");

  const rawHandler = async (data: Record<string, unknown>, msg: any) => {
    const routingKey = msg.fields.routingKey as string;

    if (routingKey === "job.created") {
      logger.debug({ jobId: data.jobId }, "Received job.created");
      await scheduleJob(data as Parameters<typeof scheduleJob>[0]);
    } else if (
      routingKey === "node.registration.requested" ||
      routingKey === "node.registered"
    ) {
      await processNodeRegistered(data);
    } else if (routingKey === "node.heartbeat") {
      await processNodeHeartbeat(data);
    }
  };

  const handler = instrumentedHandler(rawHandler, {
    queue: "scheduler.events",
    service: "scheduler-service",
  });

  channel.consume("scheduler.events", async (msg) => {
    if (!msg) return;
    try {
      await handler(msg);
      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, "Error processing scheduler event");
      channel.ack(msg);
    }
  });
}
