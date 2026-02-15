import { getChannel } from "@/config/rabbitmq";
import { v4 as uuidv4} from "uuid";

const nodeId =uuidv4() ;

export async function startFakeWorker() {
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
  channel.publish(
    "compute-bay.jobs",
    "node.registered",
    Buffer.from(
      JSON.stringify({
        nodeId,
        orgId: "org-1",
        name: "Fake Node 1",
        region: "local",
        totalCpu: 4,
        totalMemoryMb: 8192,
      })
    ),
    { persistent: true }
  );

  console.log("Fake worker registered");

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

startFakeWorker();
