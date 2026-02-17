import { NodeState } from "./cluster.state";

export function leastAllocatedFit(nodes: NodeState[]): NodeState | null {
  if (!nodes.length) return null;

  nodes.sort((a, b) => {
    const aLoad = a.usedCpu / a.totalCpu;
    const bLoad = b.usedCpu / b.totalCpu;
    return aLoad - bLoad;
  });

  return nodes[0];
}
