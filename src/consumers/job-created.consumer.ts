import { getChannel } from "@/config/rabbitmq";
import { scheduleJob } from "@/domain/scheduler.service";
import { processNodeHeartbeat } from "@/consumers/node-heartbeat.consumer";
import { processNodeRegistered } from "@/consumers/node-registered.consumer";
import { releaseGpuAllocation } from "@/domain/gpu.release";
import { getLogger, instrumentedHandler } from "@computebay/observability";

const logger = getLogger();

/**
 * Terminal job/service events from workers (via the shared `node.events`
 * exchange) and from job-service's outbox (`job.<status>` on the jobs
 * exchange). Both release the job's GPU allocation; releases are idempotent.
 */
const TERMINAL_WORKER_EVENTS = new Set([
  "job.completed",
  "job.failed",
  "job.timeout",
  "job.cancelled",
  "service.failed",
  "service.stopped",
]);

const TERMINAL_JOB_SERVICE_ROUTING_KEYS = new Set([
  "job.completed",
  "job.failed",
  "job.timeout",
  "job.cancelled",
]);

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

  // Terminal status events published by job-service (outbox).
  for (const routingKey of TERMINAL_JOB_SERVICE_ROUTING_KEYS) {
    await channel.bindQueue("scheduler.events", "compute-bay.jobs", routingKey);
  }

  // Worker lifecycle events. `node.events` is a durable topic exchange that
  // workers publish to; binding with `node.#` receives every node's events.
  await channel.assertExchange("node.events", "topic", { durable: true });
  await channel.bindQueue("scheduler.events", "node.events", "node.#");

  const rawHandler = async (data: Record<string, unknown>, msg: any) => {
    const routingKey = msg.fields.routingKey as string;

    if (routingKey === "job.created") {
      logger.debug({ jobId: data.jobId }, "Received job.created");
      await scheduleJob(data as Parameters<typeof scheduleJob>[0]);
    } else if (TERMINAL_JOB_SERVICE_ROUTING_KEYS.has(routingKey)) {
      const jobId = data.jobId as string | undefined;
      if (jobId) {
        logger.debug({ jobId, routingKey }, "Received job status event");
        await releaseGpuAllocation(jobId, `job_status_${routingKey}`);
      }
    } else if (routingKey === "node.registration.requested" || routingKey === "node.registered") {
      await processNodeRegistered(data);
    } else if (routingKey === "node.heartbeat") {
      await processNodeHeartbeat(data);
    } else if (typeof routingKey === "string" && routingKey.startsWith("node.")) {
      // Worker lifecycle event: routing key is `node.<nodeId>.events`.
      const event = data.event as string | undefined;
      if (event && TERMINAL_WORKER_EVENTS.has(event)) {
        const jobId = data.jobId as string | undefined;
        if (jobId) {
          logger.debug({ jobId, event }, "Received worker terminal event");
          await releaseGpuAllocation(jobId, `worker_${event}`);
        }
      }
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
