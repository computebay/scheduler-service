import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { NodeState } from "./cluster.state";
import type { GpuInfo } from "@/utils/gpu";
import { planNodeGpuAllocation } from "./gpu.scheduling";
import {
  gpuDeviceKey,
  gpuVendorOf,
  parseGpuRequirement,
} from "./gpu.types";

function makeNode(overrides: Partial<NodeState> = {}): NodeState {
  return {
    nodeId: "node-1",
    totalCpu: 16,
    totalMemoryMb: 32768,
    usedCpu: 0,
    usedMemoryMb: 0,
    healthy: true,
    lastHeartbeat: Date.now(),
    gpuAvailable: true,
    gpuCount: 2,
    gpuName: "NVIDIA A100",
    gpuMemoryMb: 81920,
    gpuDriverVersion: "550.54.14",
    gpuSpecs: [],
    gpuMetadataComplete: true,
    gpuExecutionReady: true,
    ...overrides,
  };
}

function nvidiaSpec(index: number, memoryMb = 40960): GpuInfo {
  return {
    id: `GPU-${index}`,
    index,
    vendor: "NVIDIA",
    name: "NVIDIA A100",
    memoryMb,
    driverVersion: "550.54.14",
    pciVendorId: "10de",
    pciAddress: `0000:01:00.${index}`,
    discoverySource: "nvidia-smi",
    executionBackends: ["cuda", "nvenc"],
  };
}

describe("parseGpuRequirement", () => {
  test("normalizes legacy values and omissions", () => {
    assert.equal(parseGpuRequirement(undefined).requirement, null);
    assert.equal(parseGpuRequirement(null).requirement, null);
    assert.deepEqual(parseGpuRequirement("none").requirement, null);
    assert.deepEqual(parseGpuRequirement("any").requirement, {
      required: true,
      count: 1,
    });
  });

  test("defaults count to one and infers vendor from backend", () => {
    const { requirement, error } = parseGpuRequirement({
      required: true,
      backend: "nvenc",
    });
    assert.equal(error, undefined);
    assert.deepEqual(requirement, {
      required: true,
      count: 1,
      vendor: "nvidia",
      backend: "nvenc",
    });
  });

  test("rejects invalid counts, VRAM and vendor/backend values", () => {
    assert.ok(
      parseGpuRequirement({ required: true, count: 0 }).error?.includes(
        "count",
      ),
    );
    assert.ok(
      parseGpuRequirement({ required: true, count: -1 }).error,
    );
    assert.ok(
      parseGpuRequirement({ required: true, count: 1.5 }).error,
    );
    assert.ok(
      parseGpuRequirement({ required: true, minMemoryMb: 0 }).error?.includes(
        "minMemoryMb",
      ),
    );
    assert.ok(
      parseGpuRequirement({ required: true, minMemoryMb: -5 }).error,
    );
    assert.ok(
      parseGpuRequirement({ required: true, vendor: "nvidya" }).error,
    );
    assert.ok(
      parseGpuRequirement({ required: true, backend: "vulkan" }).error,
    );
    assert.ok(
      parseGpuRequirement({ required: true, vendor: "amd", backend: "cuda" })
        .error,
    );
  });

  test("rejects qualifiers on a not-required GPU request", () => {
    const { requirement, error } = parseGpuRequirement({
      required: false,
      count: 2,
    });
    assert.equal(requirement, null);
    assert.ok(error?.includes("count is only valid when required is true"));
  });
});

describe("gpuVendorOf / gpuDeviceKey", () => {
  test("matches vendor from explicit report or PCI vendor id", () => {
    assert.equal(gpuVendorOf({ index: 0, vendor: "NVIDIA" }), "nvidia");
    assert.equal(gpuVendorOf({ index: 0, pciVendorId: "10DE" }), "nvidia");
    assert.equal(gpuVendorOf({ index: 0, pciVendorId: "1002" }), "amd");
    assert.equal(gpuVendorOf({ index: 0 }), undefined);
  });

  test("prefers stable identity and falls back to index", () => {
    assert.deepEqual(gpuDeviceKey({ index: 3, id: "GPU-abc" }), {
      key: "id:GPU-abc",
      stable: true,
    });
    assert.deepEqual(
      gpuDeviceKey({ index: 3, pciAddress: "0000:01:00.0" }),
      { key: "pci:0000:01:00.0", stable: true },
    );
    assert.deepEqual(gpuDeviceKey({ index: 3 }), {
      key: "index:3",
      stable: false,
    });
  });
});

describe("planNodeGpuAllocation", () => {
  const reserved = new Set<string>();

  test("returns null for CPU-only jobs", () => {
    const result = planNodeGpuAllocation(
      makeNode(),
      "job-1",
      null,
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure, undefined);
  });

  test("rejects non-NVIDIA vendors", () => {
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [nvidiaSpec(0)] }),
      "job-1",
      { required: true, count: 1, vendor: "amd" },
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_VENDOR_UNSUPPORTED");
  });

  test("rejects nodes without GPU hardware", () => {
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: null, gpuAvailable: false }),
      "job-1",
      { required: true, count: 1 },
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_HARDWARE_MISSING");
  });

  test("never schedules on unverified execution readiness", () => {
    const spec = nvidiaSpec(0);
    delete spec.executionBackends;
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [spec] }),
      "job-1",
      { required: true, count: 1 },
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_EXECUTION_UNVERIFIED");
  });

  test("selects whole devices by stable identity and reports the backend", () => {
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [nvidiaSpec(0), nvidiaSpec(1)] }),
      "job-1",
      { required: true, count: 2, minMemoryMb: 4096 },
      reserved,
    );
    assert.equal(result.failure, undefined);
    const allocation = result.allocation!;
    assert.equal(allocation.vendor, "nvidia");
    assert.equal(allocation.backend, "cuda");
    assert.equal(allocation.count, 2);
    assert.deepEqual(allocation.deviceKeys, [
      "id:GPU-0",
      "id:GPU-1",
    ]);
    assert.deepEqual(
      allocation.devices.map((device) => device.id),
      ["GPU-0", "GPU-1"],
    );
  });

  test("does not double-allocate reserved devices", () => {
    const node = makeNode({ gpuSpecs: [nvidiaSpec(0), nvidiaSpec(1)] });
    const taken = new Set(["id:GPU-0"]);
    const result = planNodeGpuAllocation(
      node,
      "job-2",
      { required: true, count: 2 },
      taken,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_CAPACITY_EXHAUSTED");

    const single = planNodeGpuAllocation(
      node,
      "job-3",
      { required: true, count: 1 },
      taken,
    );
    assert.deepEqual(single.allocation?.deviceKeys, ["id:GPU-1"]);
  });

  test("unknown VRAM never satisfies a minimum VRAM requirement", () => {
    const spec = nvidiaSpec(0);
    delete spec.memoryMb;
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [spec] }),
      "job-1",
      { required: true, count: 1, minMemoryMb: 8192 },
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_VRAM_INSUFFICIENT");
  });

  test("insufficient VRAM fails even when a backend is verified", () => {
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [nvidiaSpec(0, 8192)] }),
      "job-1",
      { required: true, count: 1, minMemoryMb: 40960 },
      reserved,
    );
    assert.equal(result.failure?.code, "GPU_VRAM_INSUFFICIENT");
  });

  test("unsupported backend reports a backend-specific failure", () => {
    const spec = nvidiaSpec(0);
    spec.executionBackends = ["cuda"];
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [spec] }),
      "job-1",
      { required: true, count: 1, backend: "nvenc" },
      reserved,
    );
    assert.equal(result.allocation, null);
    assert.equal(result.failure?.code, "GPU_BACKEND_UNSUPPORTED");
  });

  test("falls back to index identity only when no stable identity exists", () => {
    const spec = nvidiaSpec(0);
    delete spec.id;
    delete spec.pciAddress;
    const result = planNodeGpuAllocation(
      makeNode({ gpuSpecs: [spec] }),
      "job-1",
      { required: true, count: 1 },
      reserved,
    );
    assert.deepEqual(result.allocation?.deviceKeys, ["index:0"]);
    assert.equal(result.allocation?.devices[0]?.id, undefined);
  });
});
