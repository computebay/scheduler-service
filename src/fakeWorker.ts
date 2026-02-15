import { getChannel, initRabbit } from "@/config/rabbitmq";
import { v4 as uuidv4 } from "uuid";

const nodeId = uuidv4();

export async function startFakeWorker() {
  await initRabbit();
  
  const channel = getChannel();

  // 1️⃣ Declare worker queue
  await channel.assertQueue(`worker.${nodeId}`, {
    durable: true,
  });

  await channel.bindQueue(
    `worker.${nodeId}`,
    "compute-bay.jobs",
    `job.scheduled.${nodeId}`
  );

  // 2️⃣ Register node
  const nodeData = {
    nodeId,
    orgId: "org-123",
    name: "Fake Node 1",
    region: "local",
    totalCpu: 4,
    totalMemoryMb: 8192,
  };

  console.log("Publishing node registration:", nodeData);

  channel.publish(
    "compute-bay.jobs",
    "node.registered",
    Buffer.from(JSON.stringify(nodeData)),
    { persistent: true }
  );

  console.log("Fake worker registered with nodeId:", nodeId);

  // 🆕 Send periodic heartbeats
  setInterval(() => {
    channel.publish(
      "compute-bay.jobs",
      "node.heartbeat",
      Buffer.from(JSON.stringify({ nodeId })), // ← Make sure to include nodeId
      { persistent: true }
    );
    console.log("Heartbeat sent for node:", nodeId);
  }, 30000); // Every 30 seconds

  // 3️⃣ Consume assigned jobs
  channel.consume(`worker.${nodeId}`, async (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());
    console.log("Received job:", data.jobId);

    // Simulate execution delay
    setTimeout(() => {
      channel.publish(
        "compute-bay.jobs",
        "job.started",
        Buffer.from(JSON.stringify({ jobId: data.jobId })),
        { persistent: true }
      );

      setTimeout(() => {
        channel.publish(
          "compute-bay.jobs",
          "job.completed",
          Buffer.from(
            JSON.stringify({
              jobId: data.jobId,
              exitCode: 0,
            })
          ),
          { persistent: true }
        );

        channel.ack(msg);
        console.log("Job completed:", data.jobId);
      }, 2000);
    }, 1000);
  });
}

startFakeWorker().catch(console.error);