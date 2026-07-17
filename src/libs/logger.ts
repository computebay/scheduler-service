import { createLogger } from "@computebay/observability";
import { Logger } from "pino";
// Eagerly create the logger with default config
// Individual services can override via environment variables

const logger :Logger  = createLogger({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "scheduler-service",
  serviceVersion: process.env.SERVICE_VERSION ?? "1.0.0",
  environment: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",
  lokiUrl: process.env.LOKI_URL,
});

export { logger };
