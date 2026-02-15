import { initRabbit } from "@/config/rabbitmq";
import { startConsumers } from "./consumers";
import { logger } from "./libs/logger";
import { env } from "./config/env";

async function bootstrap() {
  await initRabbit();
  await startConsumers();
  // await startFakeWorker()
  logger.info({ env: env.nodeEnv, port: env.port }, 'Scheduler service started');
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Fatal scheduler error');
  process.exit(1);
});
