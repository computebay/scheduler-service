import { Prisma } from "@prisma/client";
import { prisma } from "@/config/db";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import {
  normalizeGpuVendor,
  type GpuAllocationRecord,
  type GpuAssignmentDevice,
} from "@/domain/gpu.types";

const logger = getLogger();

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function parseDevices(value: Prisma.JsonValue): GpuAssignmentDevice[] {
  if (!Array.isArray(value)) return [];

  const devices: GpuAssignmentDevice[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const device = entry as Record<string, unknown>;
    if (
      typeof device.index !== "number" ||
      !Number.isInteger(device.index) ||
      device.index < 0
    ) {
      continue;
    }
    const vendor = normalizeGpuVendor(
      typeof device.vendor === "string" ? device.vendor : undefined
    );
    if (!vendor) continue;

    devices.push({
      ...(typeof device.id === "string" && device.id.length > 0
        ? { id: device.id }
        : {}),
      index: device.index,
      vendor,
      ...(typeof device.pciAddress === "string" &&
      device.pciAddress.length > 0
        ? { pciAddress: device.pciAddress.toLowerCase() }
        : {}),
    });
  }
  return devices;
}

function parseDeviceKeys(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.length > 0
  );
}

/** Persist an ACTIVE allocation (idempotent for duplicate scheduling). */
export async function persistGpuAllocation(
  allocation: GpuAllocationRecord
): Promise<void> {
  const devices = jsonValue(allocation.devices);
  const deviceKeys = jsonValue(allocation.deviceKeys);

  await instrumentedQuery(
    "UPSERT",
    "GpuAllocation",
    "scheduler-service",
    () =>
      prisma.gpuAllocation.upsert({
        where: { jobId: allocation.jobId },
        create: {
          jobId: allocation.jobId,
          nodeId: allocation.nodeId,
          vendor: allocation.vendor,
          backend: allocation.backend,
          count: allocation.count,
          devices,
          deviceKeys,
          status: "ACTIVE",
        },
        update: {
          nodeId: allocation.nodeId,
          vendor: allocation.vendor,
          backend: allocation.backend,
          count: allocation.count,
          devices,
          deviceKeys,
          status: "ACTIVE",
          releasedAt: null,
          releaseReason: null,
        },
      }),
  );
}

/** Mark an allocation RELEASED. Safe to call more than once. */
export async function markGpuAllocationReleased(
  jobId: string,
  reason: string
): Promise<void> {
  try {
    await instrumentedQuery(
      "UPDATE",
      "GpuAllocation",
      "scheduler-service",
      () =>
        prisma.gpuAllocation.updateMany({
          where: { jobId, status: "ACTIVE" },
          data: {
            status: "RELEASED",
            releasedAt: new Date(),
            releaseReason: reason,
          },
        }),
    );
  } catch (err) {
    // Release is best-effort: never block job event handling on persistence.
    logger.warn({ err, jobId, reason }, "Failed to persist GPU allocation release");
  }
}

/** Load ACTIVE allocations so scheduler restarts can resume exclusivity. */
export async function loadActiveGpuAllocations(): Promise<
  GpuAllocationRecord[]
> {
  const rows = await instrumentedQuery(
    "SELECT",
    "GpuAllocation",
    "scheduler-service",
    () =>
      prisma.gpuAllocation.findMany({
        where: { status: "ACTIVE" },
      }),
  );

  const allocations: GpuAllocationRecord[] = [];
  for (const row of rows) {
    const devices = parseDevices(row.devices);
    const deviceKeys = parseDeviceKeys(row.deviceKeys);

    if (
      devices.length === 0 ||
      devices.length !== row.count ||
      deviceKeys.length !== row.count
    ) {
      logger.warn(
        { jobId: row.jobId, nodeId: row.nodeId },
        "Discarding malformed GPU allocation during hydration",
      );
      continue;
    }

    allocations.push({
      jobId: row.jobId,
      nodeId: row.nodeId,
      vendor: row.vendor as GpuAllocationRecord["vendor"],
      backend: row.backend as GpuAllocationRecord["backend"],
      count: row.count,
      devices,
      deviceKeys,
      createdAt: row.createdAt.getTime(),
    });
  }

  return allocations;
}
