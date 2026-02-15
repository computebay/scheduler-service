import { startJobCreatedConsumer } from "./job-created.consumer";
import { startNodeRegisteredConsumer } from "./node-registered.consumer";
import { startNodeHeartbeatConsumer } from "./node-heartbeat.consumer";
import { logger } from "../libs/logger";

export async function startConsumers() {
  await startJobCreatedConsumer();
  await startNodeRegisteredConsumer();
  await startNodeHeartbeatConsumer();
  logger.info('All consumers started');
}
