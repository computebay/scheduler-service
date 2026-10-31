import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { summarizeGpus, type GpuInfo } from "./gpu.js";

describe("summarizeGpus", () => {
  test("aggregates VRAM only when every GPU reports a known value", () => {
    const gpus: GpuInfo[] = [
      {
        index: 0,
        vendor: "NVIDIA",
        name: "NVIDIA L40S",
        memoryMb: 46068,
        driverVersion: "550.54.14",
      },
      {
        index: 1,
        vendor: "NVIDIA",
        name: "NVIDIA L40S",
        memoryMb: 46068,
        driverVersion: "550.54.14",
      },
    ];

    const summary = summarizeGpus(gpus);

    assert.equal(summary.gpuAvailable, true);
    assert.equal(summary.gpuCount, 2);
    assert.equal(summary.gpuMemoryMb, 92136);
    assert.equal(summary.gpuMetadataComplete, true);
    assert.equal(summary.gpuExecutionReady, false);
    assert.equal(summary.gpuSpecs, gpus);
  });

  test("does not misrepresent partial metadata as complete capacity", () => {
    const summary = summarizeGpus([
      {
        index: 0,
        vendor: "AMD",
        name: "AMD Radeon RX 6900 XT",
        memoryMb: 16368,
        driverVersion: "6.8.0",
      },
      {
        index: 1,
        vendor: "Intel",
        pciVendorId: "8086",
        discoverySource: "linux-sysfs",
      },
    ]);

    assert.equal(summary.gpuAvailable, true);
    assert.equal(summary.gpuCount, 2);
    assert.equal(summary.gpuMemoryMb, null);
    assert.equal(summary.gpuMetadataComplete, false);
    assert.equal(summary.gpuExecutionReady, false);
    assert.equal(summary.gpuName, "AMD Radeon RX 6900 XT");
    assert.equal(summary.gpuDriverVersion, "6.8.0");
  });

  test("reports a CPU-only node for an empty list", () => {
    const summary = summarizeGpus();

    assert.equal(summary.gpuAvailable, false);
    assert.equal(summary.gpuCount, 0);
    assert.equal(summary.gpuName, null);
    assert.equal(summary.gpuMemoryMb, null);
    assert.equal(summary.gpuDriverVersion, null);
    assert.equal(summary.gpuSpecs, undefined);
    assert.equal(summary.gpuMetadataComplete, false);
    assert.equal(summary.gpuExecutionReady, false);
  });

  test("uses the first known name and driver when earlier GPUs are partial", () => {
    const summary = summarizeGpus([
      {
        index: 0,
        vendor: "Intel",
        pciVendorId: "8086",
      },
      {
        index: 1,
        vendor: "NVIDIA",
        name: "NVIDIA T4",
        memoryMb: 15360,
        driverVersion: "535.104.05",
      },
    ]);

    assert.equal(summary.gpuName, "NVIDIA T4");
    assert.equal(summary.gpuDriverVersion, "535.104.05");
    assert.equal(summary.gpuMemoryMb, null);
    assert.equal(summary.gpuMetadataComplete, false);
  });

  test("keeps execution ready when a supported GPU is mixed with an unsupported adapter", () => {
    const summary = summarizeGpus([
      {
        index: 0,
        vendor: "NVIDIA",
        name: "GeForce RTX 3050 Laptop GPU",
        memoryMb: 4096,
        driverVersion: "610.57.04",
        executionBackends: ["cuda", "nvenc"],
      },
      {
        index: 1,
        vendor: "AMD",
        pciVendorId: "1002",
        executionBackends: [],
      },
    ]);

    assert.equal(summary.gpuAvailable, true);
    assert.equal(summary.gpuExecutionReady, true);
    assert.equal(summary.gpuMetadataComplete, false);
  });

  test("remains compatible with legacy workers that always send name and memory", () => {
    const summary = summarizeGpus([
      {
        index: 0,
        vendor: "NVIDIA",
        name: "Tesla T4",
        memoryMb: 15360,
        driverVersion: "535.104.05",
        computeCapability: "7.5",
      },
    ]);

    assert.equal(summary.gpuAvailable, true);
    assert.equal(summary.gpuCount, 1);
    assert.equal(summary.gpuMemoryMb, 15360);
    assert.equal(summary.gpuMetadataComplete, true);
  });
});
