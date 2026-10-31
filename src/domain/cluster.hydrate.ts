import { prisma } from "@/config/db";
import { clusterState } from "./cluster.state";
import { markGpuAllocationReleased } from "@/services/gpu-allocation.service";
import { gpuDeviceKey, type GpuAllocationRecord } from "./gpu.types";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import type { GpuInfo } from "@/utils/gpu";

const logger = getLogger();

/**
 * Restore ACTIVE whole-GPU allocations after a scheduler restart.
 *
 * An allocation is only restored when every device key still exists in the
 * node's hydrated inventory AND uses a stable identity (NVIDIA UUID / PCI
 * address). Index-based keys cannot distinguish a reordered device from the
 * originally selected one, so they are conservatively released instead of
 * being re-reserved against a possibly different physical GPU.
 */
async function hydrateGpuAllocations(): Promise<void> {
  const rows = await instrumentedQuery(
    "SELECT",
    "GpuAllocation",
    "scheduler-service",
    () =>
      prisma.gpuAllocation.findMany({
        where: { status: "ACTIVE" },
      }),
  );

  for (const row of rows) {
    const devices = Array.isArray(row.devices)
      ? (row.devices as unknown as GpuAllocationRecord["devices"])
      : [];
    const deviceKeys = Array.isArray(row.deviceKeys)
      ? (row.deviceKeys.filter(
          (key): key is string => typeof key === "string",
        ) as string[])
      : [];

    if (
      devices.length !== row.count ||
      deviceKeys.length !== row.count ||
      deviceKeys.some(
        (key) => key.startsWith("index:") || !key.includes(":"),
      )
    ) {
      await markGpuAllocationReleased(
        row.jobId,
        "unstable_device_identity_on_restart",
      );
      logger.warn(
        { jobId: row.jobId, nodeId: row.nodeId },
        "GPU allocation released on restart: device identity is not stable",
      );
      continue;
    }

    const nodeId = row.nodeId;
    const inventory = clusterState.getGpuSpecs(nodeId) ?? [];
    const inventoryKeys = new Set(
      inventory.map((gpu) => gpuDeviceKey(gpu).key),
    );
    const stillPresent = deviceKeys.every((key) => inventoryKeys.has(key));

    if (!stillPresent) {
      await markGpuAllocationReleased(
        row.jobId,
        "node_inventory_changed_on_restart",
      );
      logger.warn(
        { jobId: row.jobId, nodeId },
        "GPU allocation released on restart: assigned devices are no longer present",
      );
      continue;
    }

    clusterState.reserveGpuAllocation({
      jobId: row.jobId,
      nodeId,
      vendor: row.vendor as GpuAllocationRecord["vendor"],
      backend: row.backend as GpuAllocationRecord["backend"],
      count: row.count,
      devices: [...devices],
      deviceKeys,
      createdAt: row.createdAt.getTime(),
    });

    logger.info(
      { jobId: row.jobId, nodeId, deviceKeys },
      "Restored GPU allocation after restart",
    );
  }
}

/** Load REGISTERED/HEALTHY nodes from DB into in-memory cluster state (e.g. after scheduler restart). */
export async function hydrateClusterFromDb(): Promise<void> {
  try {
    const nodes = await instrumentedQuery("SELECT", "nodes", "scheduler-service", () =>
      prisma.node.findMany({
        where: { status: { in: ["REGISTERED", "HEALTHY"] } },
        select: {
          id: true,
          totalCpu: true,
          totalMemoryMb: true,
          allocatableCpu: true,
          allocatableMemoryMb: true,
          gpuAvailable: true,
          gpuCount: true,
          gpuName: true,
          gpuMemoryMb: true,
          gpuDriverVersion: true,
          gpuSpecs: true,
          gpuMetadataComplete: true,
          gpuExecutionReady: true,
        },
      }),
    );

    for (const node of nodes) {
      const cpu = node.allocatableCpu ?? node.totalCpu;
      const memory = node.allocatableMemoryMb ?? node.totalMemoryMb;
      clusterState.register({
        nodeId: node.id,
        totalCpu: cpu,
        totalMemoryMb: memory,
        usedCpu: 0,
        usedMemoryMb: 0,
        healthy: true,
        lastHeartbeat: Date.now(),
        gpuAvailable: node.gpuAvailable,
        gpuCount: node.gpuCount,
        gpuName: node.gpuName,
        gpuMemoryMb: node.gpuMemoryMb,
        gpuDriverVersion: node.gpuDriverVersion,
        gpuSpecs: Array.isArray(node.gpuSpecs)
          ? (node.gpuSpecs as unknown as GpuInfo[])
          : null,
        gpuMetadataComplete: node.gpuMetadataComplete,
        gpuExecutionReady: node.gpuExecutionReady,
      });
    }

    if (nodes.length > 0) {
      logger.info(
        {
          count: nodes.length,
          gpuNodes: nodes.filter((node) => node.gpuAvailable).length,
          clusterSize: clusterState.size(),
        },
        "Hydrated cluster state from DB",
      );
    }

    await hydrateGpuAllocations();
  } catch (err) {
    logger.error({ err }, "Failed to hydrate cluster state from DB");
  }
}
