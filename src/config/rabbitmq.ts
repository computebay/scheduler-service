import amqp from "amqplib";
import {logger} from '@/libs/logger'
let channel: amqp.Channel;

export async function initRabbit() {
  logger.info('Connecting to RabbitMQ');
  const conn = await amqp.connect(Bun.env.RABBITMQ_URL!);
  channel = await conn.createChannel();

  await channel.assertExchange("compute-bay.jobs", "topic", {
    durable: true,
  });

  logger.info('RabbitMQ connected');
}

export function getChannel() {
  if (!channel) throw new Error("Rabbit not initialized");
  return channel;
}
