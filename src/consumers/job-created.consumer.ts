import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";
import { logger } from "../libs/logger";

export async function startSchedulerConsumer() {
  const channel = getChannel();

  await channel.assertQueue("scheduler.events", {
    durable: true,
  });

  // Bind to job.created
  await channel.bindQueue(
    "scheduler.events",
    "compute-bay.jobs",
    "job.created"
  );

  // Bind to node.#
  await channel.bindQueue(
    "scheduler.events",
    "compute-bay.jobs",
    "node.#"
  );

  channel.consume("scheduler.events", async (msg) => {
    if (!msg) return;

    try {
      const routingKey = msg.fields.routingKey;
      const data = JSON.parse(msg.content.toString());

      if (routingKey === "job.created") {
        logger.debug({ jobId: data.jobId }, "Received job.created");
        await scheduleJob(data);
      }

      // Later:
      // if (routingKey.startsWith("node.")) { ... }

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, "Error processing scheduler event");
      // do NOT ack on failure
    }
  });
}

