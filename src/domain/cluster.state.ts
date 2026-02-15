export interface NodeState {
  nodeId: string;
  totalCpu: number;
  totalMemoryMb: number;
  usedCpu: number;
  usedMemoryMb: number;
  healthy: boolean;
  lastHeartbeat: number;
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

  getEligible(cpu: number, memory: number): NodeState[] {
    return [...this.nodes.values()].filter(
      (n) =>
        n.healthy &&
        n.totalCpu - n.usedCpu >= cpu &&
        n.totalMemoryMb - n.usedMemoryMb >= memory
    );
  }

  reserve(nodeId: string, cpu: number, memory: number) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.usedCpu += cpu;
    node.usedMemoryMb += memory;
  }

  /** Number of nodes currently in memory (for debugging / startup hydration). */
  size(): number {
    return this.nodes.size;
  }
}

export const clusterState = new ClusterState();
