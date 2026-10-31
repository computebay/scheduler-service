import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { clusterState } from "./cluster.state";
import type { GpuAllocationRecord } from "./gpu.types";
import type { GpuInfo } from "@/utils/gpu";

function nvidiaSpec(index: number): GpuInfo {
  return {
    id: `GPU-${index}`,
    index,
    vendor: "NVIDIA",
    name: "NVIDIA A100",
    memoryMb: 40960,
    driverVersion: "550.54.14",
    executionBackends: ["cuda", "nvenc"],
  };
}

function allocation(jobId: string, nodeId: string, keys: string[]): GpuAllocationRecord {
  return {
    jobId,
    nodeId,
    vendor: "nvidia",
    backend: "cuda",
    count: keys.length,
    devices: keys.map((key, index) => ({
      id: key.replace(/^id:/, ""),
      index,
      vendor: "nvidia",
    })),
    deviceKeys: keys,
    createdAt: Date.now(),
  };
}

describe("clusterState GPU allocations", () => {
  beforeEach(() => {
    for (const record of clusterState.listGpuAllocations()) {
      clusterState.releaseGpuAllocation(record.jobId);
    }
    clusterState.register({
      nodeId: "gpu-node",
      totalCpu: 8,
      totalMemoryMb: 16384,
      usedCpu: 0,
      usedMemoryMb: 0,
      healthy: true,
      lastHeartbeat: Date.now(),
      gpuAvailable: true,
      gpuCount: 2,
      gpuName: "NVIDIA A100",
      gpuMemoryMb: 81920,
      gpuDriverVersion: "550.54.14",
      gpuSpecs: [nvidiaSpec(0), nvidiaSpec(1)],
      gpuMetadataComplete: true,
      gpuExecutionReady: true,
    });
  });

  test("reserve and release keep device keys exclusive per node", () => {
    clusterState.reserveGpuAllocation(allocation("job-1", "gpu-node", ["id:GPU-0"]));
    assert.deepEqual(
      [...clusterState.getReservedGpuKeys("gpu-node")],
      ["id:GPU-0"],
    );

    // Duplicate delivery of the same allocation is idempotent.
    clusterState.reserveGpuAllocation(allocation("job-1", "gpu-node", ["id:GPU-0"]));
    assert.deepEqual(
      [...clusterState.getReservedGpuKeys("gpu-node")],
      ["id:GPU-0"],
    );

    const released = clusterState.releaseGpuAllocation("job-1");
    assert.equal(released?.jobId, "job-1");
    assert.equal(clusterState.getReservedGpuKeys("gpu-node").size, 0);
  });

  test("releaseGpuAllocation returns undefined for unknown jobs", () => {
    assert.equal(clusterState.releaseGpuAllocation("missing"), undefined);
  });

  test("markUnhealthy releases every allocation held by the node", () => {
    clusterState.reserveGpuAllocation(allocation("job-a", "gpu-node", ["id:GPU-0"]));
    clusterState.reserveGpuAllocation(allocation("job-b", "gpu-node", ["id:GPU-1"]));

    const released = clusterState.markUnhealthy("gpu-node");
    assert.equal(clusterState.isHealthy("gpu-node"), false);
    assert.deepEqual(
      released.map((record) => record.jobId).sort(),
      ["job-a", "job-b"],
    );
    assert.equal(clusterState.getGpuAllocation("job-a"), undefined);
    assert.equal(clusterState.getGpuAllocation("job-b"), undefined);
    assert.equal(clusterState.getReservedGpuKeys("gpu-node").size, 0);
  });

  test("conflicting device keys are re-allocated safely", () => {
    clusterState.reserveGpuAllocation(allocation("job-x", "gpu-node", ["id:GPU-0"]));
    // A different allocation of the same device first releases the old one.
    clusterState.reserveGpuAllocation(allocation("job-y", "gpu-node", ["id:GPU-0"]));
    assert.equal(clusterState.getGpuAllocation("job-x"), undefined);
    assert.ok(clusterState.getGpuAllocation("job-y"));
  });
});
