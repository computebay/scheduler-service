import { initRabbit } from "@/config/rabbitmq";
import { startConsumers } from "./consumers";
import { startNodeHealthCheck } from "@/services/node-health-check.service";
import { logger } from "./libs/logger";
import { env } from "./config/env";
import { startHttpServer } from "@/api/http.server";

async function bootstrap() {
  await initRabbit();
  await startConsumers();
  startNodeHealthCheck();
  startHttpServer();
  // await startFakeWorker()
  logger.info(
    { env: env.nodeEnv, port: env.port },
    "Scheduler service started",
  );
}

bootstrap().catch((err) => {
  logger.error({ err }, "Fatal scheduler error");
  process.exit(1);
});
