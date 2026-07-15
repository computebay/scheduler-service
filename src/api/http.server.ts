import express from "express";
import cors from "cors";
import { env } from "@/config/env";
import { getLogger, getMetrics, observabilityMiddleware } from "@computebay/observability";
import { nodesRouter } from "./nodes.routes";

const logger = getLogger();

export function startHttpServer() {
  const app = express();

  // Observability middleware - adds request_id, trace context, metrics, structured logging
  app.use(observabilityMiddleware("scheduler-service"));

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_, res) => {
    res.status(200).json({
      status: "ok",
      service: "scheduler-service",
    });
  });

  // Prometheus metrics endpoint
  app.get("/metrics", async (_, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(await getMetrics());
  });

  app.use("/nodes", nodesRouter);

  const server = app.listen(env.port, () => {
    logger.info({ port: env.port }, "HTTP server listening");
  });

  return { app, server };
}
