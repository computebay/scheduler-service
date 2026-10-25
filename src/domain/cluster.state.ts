import type { GpuInfo, GpuSummary } from "@/utils/gpu";

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

  markUnhealthy(nodeId: string) {
    const node = this.nodes.get(nodeId);
    if (node) node.healthy = false;
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

  /** Number of nodes currently in memory (for debugging / startup hydration). */
  size(): number {
    return this.nodes.size;
  }
}

export const clusterState = new ClusterState();
