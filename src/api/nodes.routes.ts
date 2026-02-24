import { Router } from "express";
import { heartbeatNode, registerNode } from "./nodes.controller";
import { requireWorkerRegistrationToken } from "./middleware/auth.middleware";

export const nodesRouter = Router();

nodesRouter.post("/register", requireWorkerRegistrationToken, registerNode);
nodesRouter.post("/heartbeat", requireWorkerRegistrationToken, heartbeatNode);

