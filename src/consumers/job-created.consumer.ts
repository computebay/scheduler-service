import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";
import { processNodeHeartbeat } from "@/consumers/node-heartbeat.consumer";
import { processNodeRegistered } from "@/consumers/node-registered.consumer";
import { logger } from "../libs/logger";

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

  channel.consume("scheduler.events", async (msg) => {
    if (!msg) return;

    try {
      const routingKey = msg.fields.routingKey as string;
      const data = JSON.parse(msg.content.toString()) as Record<string, unknown>;

      if (routingKey === "job.created") {
        logger.debug({ jobId: data.jobId }, "Received job.created");
        await scheduleJob(
          data as {
            jobId: string;
            orgId: string;
            resources: { cpu: number; memoryMB: number };
          },
        );
      } else if (
        routingKey === "node.registration.requested" ||
        routingKey === "node.registered"
      ) {
        await processNodeRegistered(data);
      } else if (routingKey === "node.heartbeat") {
        await processNodeHeartbeat(data);
      }

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, "Error processing scheduler event");
    }
  });
}
