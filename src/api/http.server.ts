import express from "express";
import cors from "cors";
import { env } from "@/config/env";
import { logger } from "@/libs/logger";
import { nodesRouter } from "./nodes.routes";

export function startHttpServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_, res) => {
    res.status(200).json({
      status: "ok",
      service: "scheduler-service"
    });
  });
  app.use("/nodes", nodesRouter);

  const server = app.listen(env.port, () => {
    logger.info({ port: env.port }, "HTTP server listening");
  });

  return { app, server };
}

