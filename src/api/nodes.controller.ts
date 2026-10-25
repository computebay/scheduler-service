import type { Request, Response } from "express";
import { z } from "zod";
import { nodesService } from "@/services/nodes.service";

const gpuSchema = z.object({
  id: z.string().min(1).optional(),
  index: z.number().int().nonnegative(),
  vendor: z.string().min(1).optional(),
  // Optional: sysfs discovery may not know the model or VRAM.
  name: z.string().min(1).optional(),
  memoryMb: z.number().int().nonnegative().optional(),
  driverVersion: z.string().min(1).optional(),
  computeCapability: z.string().min(1).optional(),
  pciVendorId: z.string().min(1).optional(),
  pciDeviceId: z.string().min(1).optional(),
  pciAddress: z.string().min(1).optional(),
  discoverySource: z.string().min(1).optional(),
});

const registerSchema = z.object({
  machineId: z.string().min(1),
  cpuCores: z.number().int().positive(),
  memoryMB: z.number().int().positive(),
  agentVersion: z.string().min(1),
  // Optional for backward compatibility with older workers.
  gpus: z.array(gpuSchema).max(64).optional(),
});

const heartbeatSchema = z.object({
  nodeId: z.string().uuid(),
  availableCpu: z.number().int().nonnegative(),
  availableMemoryMB: z.number().int().nonnegative(),
  // Optional for backward compatibility with older workers.
  gpus: z.array(gpuSchema).max(64).optional(),
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

