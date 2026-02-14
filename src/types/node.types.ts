// Node Types

export interface INode {
  id: string;
  hostname: string;
  cpuCores: number;
  memoryMb: number;
  status: 'healthy' | 'unhealthy';
  lastHeartbeat: Date;
}

export interface INodeResources {
  availableCpuCores: number;
  availableMemoryMb: number;
}
