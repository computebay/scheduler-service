import { Prisma } from "@prisma/client";
import { clusterState } from "../domain/cluster.state";
import { prisma } from "@/config/db";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import { verifyWorkerMessageWithProvidedKey } from "../security/signature.verify";
import { summarizeGpus, type GpuInfo, type GpuSummary } from "@/utils/gpu";

const logger = getLogger();

/**
 * Build a summary from an event that carries the flattened GPU fields but not
 * the per-device list (older producers). Missing GPU fields return undefined
 * so an existing row keeps its GPU metadata.
 */
function readGpuSummary(data: Record<string, unknown>): GpuSummary | undefined {
  if (Array.isArray(data.gpuSpecs)) {
    return summarizeGpus(data.gpuSpecs as GpuInfo[]);
  }

  if (data.gpuAvailable === undefined && data.gpuCount === undefined) {
    return undefined;
  }

  const gpuCount =
    typeof data.gpuCount === "number" && Number.isFinite(data.gpuCount)
      ? Math.max(0, Math.trunc(data.gpuCount))
      : 0;

  return {
    gpuAvailable: data.gpuAvailable === true || gpuCount > 0,
    gpuName: typeof data.gpuName === "string" ? data.gpuName : null,
    gpuCount,
    gpuMemoryMb:
      typeof data.gpuMemoryMb === "number" &&
      Number.isFinite(data.gpuMemoryMb)
        ? data.gpuMemoryMb
        : null,
    gpuDriverVersion:
      typeof data.gpuDriverVersion === "string"
        ? data.gpuDriverVersion
        : null,
    gpuSpecs: undefined,
    gpuMetadataComplete: data.gpuMetadataComplete === true,
    gpuExecutionReady: data.gpuExecutionReady === true,
  };
}

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

  const gpu = readGpuSummary(data);
  const gpuSpecs = gpu?.gpuSpecs
    ? (gpu.gpuSpecs as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;
  // An explicit empty/CPU-only GPU report clears stale specs. A summary-only
  // report for a GPU node keeps whatever per-device list is already stored.
  const writeGpuSpecs = Array.isArray(data.gpuSpecs) || gpu?.gpuCount === 0;
  const gpuUpdate = gpu
    ? {
        gpuAvailable: gpu.gpuAvailable,
        gpuName: gpu.gpuName,
        gpuCount: gpu.gpuCount,
        gpuMemoryMb: gpu.gpuMemoryMb,
        gpuDriverVersion: gpu.gpuDriverVersion,
        ...(writeGpuSpecs ? { gpuSpecs } : {}),
        gpuMetadataComplete: gpu.gpuMetadataComplete,
        gpuExecutionReady: gpu.gpuExecutionReady,
      }
    : {};

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

  const existing = await instrumentedQuery("SELECT", "nodes", "scheduler-service", () =>
    prisma.node.findUnique({
      where: { id: nodeId },
      select: {
        publicKey: true,
        gpuAvailable: true,
        gpuName: true,
        gpuCount: true,
        gpuMemoryMb: true,
        gpuDriverVersion: true,
        gpuSpecs: true,
        gpuMetadataComplete: true,
        gpuExecutionReady: true,
      },
    }),
  );
  const publicKeyToStore = existing?.publicKey ?? publicKey ?? null;
  const existingGpu: GpuSummary | undefined = existing
    ? {
        gpuAvailable: existing.gpuAvailable,
        gpuName: existing.gpuName,
        gpuCount: existing.gpuCount,
        gpuMemoryMb: existing.gpuMemoryMb,
        gpuDriverVersion: existing.gpuDriverVersion,
        gpuSpecs: Array.isArray(existing.gpuSpecs)
          ? (existing.gpuSpecs as unknown as GpuInfo[])
          : undefined,
        gpuMetadataComplete: existing.gpuMetadataComplete,
        gpuExecutionReady: existing.gpuExecutionReady,
      }
    : undefined;
  const effectiveGpu = gpu
    ? {
        ...gpu,
        // A summary-only GPU report may omit the per-device list while the
        // stored specs are still valid. A CPU-only report clears them.
        gpuSpecs:
          gpu.gpuCount > 0 ? (gpu.gpuSpecs ?? existingGpu?.gpuSpecs) : undefined,
      }
    : existingGpu;

  await instrumentedQuery("UPSERT", "nodes", "scheduler-service", () =>
    prisma.node.upsert({
      where: { id: nodeId },
      update: {
        totalCpu,
        totalMemoryMb,
        allocatableCpu,
        allocatableMemoryMb,
        ...gpuUpdate,
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
        ...gpuUpdate,
        publicKey: publicKeyToStore,
        status: "REGISTERED",
        lastHeartbeatAt: new Date(),
      },
    }),
  );

  clusterState.register({
    nodeId,
    totalCpu: allocatableCpu,
    totalMemoryMb: allocatableMemoryMb,
    usedCpu: 0,
    usedMemoryMb: 0,
    healthy: true,
    lastHeartbeat: Date.now(),
    gpuAvailable: effectiveGpu?.gpuAvailable ?? false,
    gpuCount: effectiveGpu?.gpuCount ?? 0,
    gpuName: effectiveGpu?.gpuName ?? null,
    gpuMemoryMb: effectiveGpu?.gpuMemoryMb ?? null,
    gpuDriverVersion: effectiveGpu?.gpuDriverVersion ?? null,
    gpuSpecs: effectiveGpu?.gpuSpecs ?? null,
    gpuMetadataComplete: effectiveGpu?.gpuMetadataComplete ?? false,
    gpuExecutionReady: effectiveGpu?.gpuExecutionReady ?? false,
  });

  logger.info(
    {
      nodeId,
      gpuAvailable: effectiveGpu?.gpuAvailable ?? false,
      gpuCount: effectiveGpu?.gpuCount ?? 0,
      gpuName: effectiveGpu?.gpuName ?? null,
      gpuMetadataComplete: effectiveGpu?.gpuMetadataComplete ?? false,
      gpuExecutionReady: effectiveGpu?.gpuExecutionReady ?? false,
    },
    "Node registered"
  );
}
