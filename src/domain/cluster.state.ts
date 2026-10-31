import type { GpuInfo, GpuSummary } from "@/utils/gpu";
import type { GpuAllocationRecord } from "./gpu.types";

export interface NodeState {
  nodeId: string;
  totalCpu: number;
  totalMemoryMb: number;
  usedCpu: number;
  usedMemoryMb: number;
  healthy: boolean;
  lastHeartbeat: number;
  gpuAvailable: boolean;
  gpuCount: number;
  gpuName: string | null;
  gpuMemoryMb: number | null;
  gpuDriverVersion: string | null;
  gpuSpecs: GpuInfo[] | null;
  gpuMetadataComplete: boolean;
  gpuExecutionReady: boolean;
}

class ClusterState {
  private nodes = new Map<string, NodeState>();

  /** Active whole-GPU allocations, keyed by jobId. */
  private gpuAllocations = new Map<string, GpuAllocationRecord>();
  /** Reserved device keys per node, derived from gpuAllocations. */
  private reservedGpuKeys = new Map<string, Set<string>>();

  register(node: NodeState) {
    this.nodes.set(node.nodeId, node);
  }

  heartbeat(nodeId: string, usedCpu: number, usedMemoryMb: number) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.usedCpu = usedCpu;
    node.usedMemoryMb = usedMemoryMb;
    node.lastHeartbeat = Date.now();
    node.healthy = true;
  }

  markUnhealthy(nodeId: string): GpuAllocationRecord[] {
    const node = this.nodes.get(nodeId);
    if (node) node.healthy = false;

    // A node that stopped heartbeating can no longer be trusted to run (or
    // later release) its GPU jobs, so drop local reservations immediately.
    return this.releaseGpuAllocationsForNode(nodeId);
  }

  isHealthy(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.healthy === true;
  }

  updateGpuInfo(nodeId: string, gpu: GpuSummary) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.gpuAvailable = gpu.gpuAvailable;
    node.gpuCount = gpu.gpuCount;
    node.gpuName = gpu.gpuName;
    node.gpuMemoryMb = gpu.gpuMemoryMb;
    node.gpuDriverVersion = gpu.gpuDriverVersion;
    node.gpuSpecs = gpu.gpuSpecs ?? null;
    node.gpuMetadataComplete = gpu.gpuMetadataComplete;
    node.gpuExecutionReady = gpu.gpuExecutionReady;
  }

  getEligible(cpu: number, memory: number): NodeState[] {
    return [...this.nodes.values()].filter(
      (n) =>
        n.healthy &&
        n.totalCpu - n.usedCpu >= cpu &&
        n.totalMemoryMb - n.usedMemoryMb >= memory,
    );
  }

  reserve(nodeId: string, cpu: number, memory: number) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.usedCpu += cpu;
    node.usedMemoryMb += memory;
  }

  release(nodeId: string, cpu: number, memory: number) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.usedCpu = Math.max(0, node.usedCpu - cpu);
    node.usedMemoryMb = Math.max(0, node.usedMemoryMb - memory);
  }

  getGpuAllocation(jobId: string): GpuAllocationRecord | undefined {
    return this.gpuAllocations.get(jobId);
  }

  listGpuAllocations(): GpuAllocationRecord[] {
    return [...this.gpuAllocations.values()];
  }

  /** Device keys already reserved on a node (for matcher input). */
  getReservedGpuKeys(nodeId: string): ReadonlySet<string> {
    return this.reservedGpuKeys.get(nodeId) ?? new Set<string>();
  }

  /** Current GPU inventory of a node (used by allocation hydration). */
  getGpuSpecs(nodeId: string): GpuInfo[] | null {
    return this.nodes.get(nodeId)?.gpuSpecs ?? null;
  }

  /**
   * Record an active allocation. Idempotent for duplicate scheduling
   * redeliveries of the same job.
   */
  reserveGpuAllocation(allocation: GpuAllocationRecord): void {
    const existing = this.gpuAllocations.get(allocation.jobId);
    if (existing) {
      if (
        existing.nodeId === allocation.nodeId &&
        existing.deviceKeys.length === allocation.deviceKeys.length &&
        existing.deviceKeys.every((key) =>
          allocation.deviceKeys.includes(key)
        )
      ) {
        return;
      }
      this.releaseGpuAllocation(allocation.jobId);
    }

    // Safety net: no device key may be held by two allocations at once.
    for (const [jobId, held] of [...this.gpuAllocations.entries()]) {
      if (
        held.deviceKeys.some((key) => allocation.deviceKeys.includes(key))
      ) {
        this.releaseGpuAllocation(jobId);
      }
    }

    this.gpuAllocations.set(allocation.jobId, allocation);
    let keys = this.reservedGpuKeys.get(allocation.nodeId);
    if (!keys) {
      keys = new Set<string>();
      this.reservedGpuKeys.set(allocation.nodeId, keys);
    }
    for (const key of allocation.deviceKeys) {
      keys.add(key);
    }
  }

  releaseGpuAllocation(jobId: string): GpuAllocationRecord | undefined {
    const allocation = this.gpuAllocations.get(jobId);
    if (!allocation) return undefined;

    this.gpuAllocations.delete(jobId);
    const keys = this.reservedGpuKeys.get(allocation.nodeId);
    if (keys) {
      for (const key of allocation.deviceKeys) {
        keys.delete(key);
      }
      if (keys.size === 0) {
        this.reservedGpuKeys.delete(allocation.nodeId);
      }
    }
    return allocation;
  }

  releaseGpuAllocationsForNode(nodeId: string): GpuAllocationRecord[] {
    const released: GpuAllocationRecord[] = [];
    for (const allocation of [...this.gpuAllocations.values()]) {
      if (allocation.nodeId === nodeId) {
        const removed = this.releaseGpuAllocation(allocation.jobId);
        if (removed) released.push(removed);
      }
    }
    return released;
  }

  /** Number of nodes currently in memory (for debugging / startup hydration). */
  size(): number {
    return this.nodes.size;
  }
}

export const clusterState = new ClusterState();
