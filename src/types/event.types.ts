// Event Types

export interface IJobCreatedEvent {
  jobId: string;
  cpuRequired: number;
  memoryRequired: number;
  createdAt: Date;
}

export interface IHeartbeatEvent {
  nodeId: string;
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
}

export interface INodeRegisteredEvent {
  nodeId: string;
  hostname: string;
  cpuCores: number;
  memoryMb: number;
}
