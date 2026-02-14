// Cluster State
// Manages the state of nodes in the cluster

export class ClusterState {
  private nodes: Map<string, any> = new Map();

  addNode(nodeId: string, nodeInfo: any): void {
    this.nodes.set(nodeId, nodeInfo);
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): any {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): any[] {
    return Array.from(this.nodes.values());
  }
}
