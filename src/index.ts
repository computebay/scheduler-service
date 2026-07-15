import { loadObservabilityConfig, initTelemetry, createLogger, createMetricsServer } from "@computebay/observability";
import { initRabbit } from "@/config/rabbitmq";
import { startConsumers } from "./consumers";
import { startNodeHealthCheck } from "@/services/node-health-check.service";
import { startHttpServer } from "@/api/http.server";

const observabilityConfig = loadObservabilityConfig({
  serviceName: "scheduler-service",
  serviceVersion: process.env.SERVICE_VERSION ?? "1.0.0",
});

// Initialize telemetry BEFORE anything else
initTelemetry(observabilityConfig);

const logger = createLogger(observabilityConfig);

async function bootstrap() {
  // Start metrics server
  createMetricsServer(observabilityConfig);

  await initRabbit();
  await startConsumers();
  startNodeHealthCheck();
  startHttpServer();

  logger.info(
    { env: observabilityConfig.environment, port: process.env.PORT ?? 3000 },
    "Scheduler service started",
  );
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Fatal scheduler error");
  process.exit(1);
});
