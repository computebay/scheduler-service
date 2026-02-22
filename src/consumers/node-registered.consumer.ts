import { clusterState } from "../domain/cluster.state";
import { prisma } from "@/config/db";
import { logger } from "../libs/logger";
import { verifyWorkerMessageWithProvidedKey } from "../security/signature.verify";

/**
 * Process node.registration.requested or node.registered.
 * Verifies signature, stores publicKey, registers node and adds to cluster immediately.
 * No approval step – automatic registration.
 */
export async function processNodeRegistered(
  data: Record<string, unknown>,
): Promise<void> {
  const nodeId = (data.nodeId ?? data.id) as string | undefined;
  if (!nodeId || typeof nodeId !== "string") {
    logger.warn(
      { data, keys: Object.keys(data || {}) },
      "node registration missing nodeId – skipping",
    );
    return;
  }

  const publicKey = data.publicKey as string | undefined;
  const totalCpu = Number(data.totalCpu) ?? 0;
  const totalMemoryMb = Number(data.totalMemoryMb) ?? 0;

  if (totalCpu <= 0 || totalMemoryMb <= 0) {
    logger.warn({ nodeId }, "Invalid totalCpu/totalMemoryMb – skipping");
    return;
  }

  const allocatableCpu = Number(data.allocatableCpu) ?? totalCpu;
  const allocatableMemoryMb = Number(data.allocatableMemoryMb) ?? totalMemoryMb;
  const orgId = (data.orgId ?? data.org_id ?? "default") as string;
  const name = (data.name ?? nodeId) as string;

  // If publicKey + signature present, verify
  if (publicKey && typeof publicKey === "string" && data.signature) {
    const valid = await verifyWorkerMessageWithProvidedKey(
      nodeId,
      data as Record<string, unknown>,
      publicKey,
    );
    if (!valid) {
      logger.warn({ nodeId }, "Signature verification failed – rejecting");
      return;
    }
  }

  const existing = await prisma.node.findUnique({ where: { id: nodeId }, select: { publicKey: true } });
  const publicKeyToStore = existing?.publicKey ?? publicKey ?? null;

  await prisma.node.upsert({
    where: { id: nodeId },
    update: {
      totalCpu,
      totalMemoryMb,
      allocatableCpu,
      allocatableMemoryMb,
      lastHeartbeatAt: new Date(),
      status: "REGISTERED",
      publicKey: publicKeyToStore,
      updatedAt: new Date(),
    },
    create: {
      id: nodeId,
      orgId,
      name,
      region: (data.region as string) ?? null,
      totalCpu,
      totalMemoryMb,
      allocatableCpu,
      allocatableMemoryMb,
      publicKey: publicKeyToStore,
      status: "REGISTERED",
      lastHeartbeatAt: new Date(),
    },
  });

  clusterState.register({
    nodeId,
    totalCpu: allocatableCpu,
    totalMemoryMb: allocatableMemoryMb,
    usedCpu: 0,
    usedMemoryMb: 0,
    healthy: true,
    lastHeartbeat: Date.now(),
  });

  logger.info({ nodeId }, "Node registered");
}
