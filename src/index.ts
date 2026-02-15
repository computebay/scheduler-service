import { initRabbit } from "@/config/rabbitmq";
import { startConsumers } from "./consumers";
import { logger } from "./libs/logger";

async function bootstrap() {
  await initRabbit();
  await startConsumers();
  logger.info("Scheduler service started");
}

bootstrap().catch((err) => {
  logger.error("Fatal scheduler error", err);
  process.exit(1);
});
