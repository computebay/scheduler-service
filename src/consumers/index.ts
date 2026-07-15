import { startSchedulerConsumer } from "./job-created.consumer";
import { hydrateClusterFromDb } from "@/domain/cluster.hydrate";
import { getLogger } from "@computebay/observability";

const logger = getLogger();

export async function startConsumers() {
  await hydrateClusterFromDb();
  await startSchedulerConsumer();
  logger.info("All consumers started");
}
