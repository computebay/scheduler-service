import { startSchedulerConsumer } from "./job-created.consumer";
import { startNodeRegisteredConsumer } from "./node-registered.consumer";
import { startNodeHeartbeatConsumer } from "./node-heartbeat.consumer";
import { hydrateClusterFromDb } from "@/domain/cluster.hydrate";
import { logger } from "../libs/logger";

export async function startConsumers() {
  await hydrateClusterFromDb();
  await startSchedulerConsumer();
  await startNodeRegisteredConsumer();
  await startNodeHeartbeatConsumer();
  logger.info("All consumers started");
}
