import { clusterState } from "./cluster.state";
import { markGpuAllocationReleased } from "@/services/gpu-allocation.service";
import { getLogger } from "@computebay/observability";
import type { GpuAllocationRecord } from "./gpu.types";

const logger = getLogger();

function toDbReason(reason: string): string {
  return reason.slice(0, 200);
}

/**
 * Release the whole-GPU allocation held by a job (worker terminal event,
 * cancellation, or duplicate redelivery) and persist the release.
 * Idempotent: repeated events and unknown jobs are safe no-ops.
 */
export async function releaseGpuAllocation(
  jobId: string,
  reason: string,
): Promise<GpuAllocationRecord | undefined> {
  try {
    const allocation = clusterState.releaseGpuAllocation(jobId);
    await markGpuAllocationReleased(jobId, toDbReason(reason));
    if (allocation) {
      logger.info(
        { jobId, nodeId: allocation.nodeId, reason },
        "Released GPU allocation",
      );
    }
    return allocation;
  } catch (err) {
    logger.warn(
      { err, jobId, reason },
      "Failed to release GPU allocation",
    );
    return undefined;
  }
}

/**
 * Release every allocation held by a node (heartbeat loss, disappeared
 * worker, or loss of a verified execution backend).
 */
export async function releaseGpuAllocationsForNode(
  nodeId: string,
  reason: string,
): Promise<GpuAllocationRecord[]> {
  try {
    const allocations = clusterState.releaseGpuAllocationsForNode(nodeId);
    for (const allocation of allocations) {
      await markGpuAllocationReleased(allocation.jobId, toDbReason(reason));
    }
    if (allocations.length > 0) {
      logger.warn(
        { nodeId, count: allocations.length, reason },
        "Released GPU allocations for node",
      );
    }
    return allocations;
  } catch (err) {
    logger.warn(
      { err, nodeId, reason },
      "Failed to release GPU allocations for node",
    );
    return [];
  }
}
