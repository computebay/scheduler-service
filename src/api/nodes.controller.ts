import type { Request, Response } from "express";
import { z } from "zod";
import { nodesService } from "@/services/nodes.service";

const registerSchema = z.object({
  machineId: z.string().min(1),
  cpuCores: z.number().int().positive(),
  memoryMB: z.number().int().positive(),
  agentVersion: z.string().min(1),
});

const heartbeatSchema = z.object({
  nodeId: z.string().uuid(),
  availableCpu: z.number().int().nonnegative(),
  availableMemoryMB: z.number().int().nonnegative(),
});

export async function registerNode(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const result = await nodesService.register(parsed.data);
  return res.status(201).json(result);
}

export async function heartbeatNode(req: Request, res: Response) {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  await nodesService.heartbeat(parsed.data);
  return res.status(200).json({ ok: true });
}

