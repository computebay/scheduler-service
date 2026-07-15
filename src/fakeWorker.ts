import { getChannel, initRabbit } from "@/config/rabbitmq";
import { v4 as uuidv4 } from "uuid";
import { getLogger } from "@computebay/observability";

const logger = getLogger();
const nodeId = uuidv4();

export async function startFakeWorker() {
  await initRabbit();

  const channel = getChannel();

  await channel.assertQueue(`worker.${nodeId}`, {
    durable: true,
  });

  await channel.bindQueue(
    `worker.${nodeId}`,
    "compute-bay.jobs",
    `job.scheduled.${nodeId}`,
  );

  const nodeData = {
    nodeId,
    orgId: "org-123",
    name: "Fake Node 1",
    region: "local",
    totalCpu: 4,
    totalMemoryMb: 8192,
  };

  logger.info({ nodeData }, "Publishing node registration");

  channel.publish(
    "compute-bay.jobs",
    "node.registered",
    Buffer.from(JSON.stringify(nodeData)),
    { persistent: true },
  );

  logger.info({ nodeId }, "Fake worker registered");

  // Send periodic heartbeats
  setInterval(() => {
    channel.publish(
      "compute-bay.jobs",
      "node.heartbeat",
      Buffer.from(JSON.stringify({ nodeId })),
      { persistent: true },
    );
    logger.debug({ nodeId }, "Heartbeat sent");
  }, 30000);

  // Consume assigned jobs
  channel.consume(`worker.${nodeId}`, async (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());
    logger.info({ jobId: data.jobId }, "Received job");

    // Simulate execution delay
    setTimeout(() => {
      channel.publish(
        "compute-bay.jobs",
        "job.started",
        Buffer.from(JSON.stringify({ jobId: data.jobId })),
        { persistent: true },
      );

      setTimeout(() => {
        channel.publish(
          "compute-bay.jobs",
          "job.completed",
          Buffer.from(
            JSON.stringify({
              jobId: data.jobId,
              exitCode: 0,
            }),
          ),
          { persistent: true },
        );

        channel.ack(msg);
        logger.info({ jobId: data.jobId }, "Job completed");
      }, 2000);
    }, 1000);
  });
}

startFakeWorker().catch((err) => {
  logger.fatal({ err }, "Fake worker failed");
});
