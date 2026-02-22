import { startSchedulerConsumer } from "./job-created.consumer";
import { hydrateClusterFromDb } from "@/domain/cluster.hydrate";
import { logger } from "../libs/logger";

export async function startConsumers() {
  await hydrateClusterFromDb();
  await startSchedulerConsumer();
  logger.info("All consumers started");
}
