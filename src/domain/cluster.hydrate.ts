import { prisma } from "@/config/db";
import { clusterState } from "./cluster.state";
import { getLogger, instrumentedQuery } from "@computebay/observability";
import type { GpuInfo } from "@/utils/gpu";

const logger = getLogger();

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
  } catch (err) {
    logger.error({ err }, "Failed to hydrate cluster state from DB");
  }
}
