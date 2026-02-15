import amqp from "amqplib";

let channel: amqp.Channel;

export async function initRabbit() {
  const conn = await amqp.connect(Bun.env.RABBITMQ_URL!);
  channel = await conn.createChannel();

  await channel.assertExchange("compute-bay.jobs", "topic", {
    durable: true,
  });
}

export function getChannel() {
  if (!channel) throw new Error("Rabbit not initialized");
  return channel;
}
