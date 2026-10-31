/**
 * GPU details as reported by a worker at registration/heartbeat.
 * Kept in sync with `worker-agent/src/monitoring/gpu.types.ts`.
 *
 * Fields are optional because sysfs fallback discovery may establish a PCI
 * identity without knowing the model, VRAM or driver version.
 */
export interface GpuInfo {
  id?: string;
  index: number;
  vendor?: string;
  name?: string;
  memoryMb?: number;
  driverVersion?: string;
  computeCapability?: string;
  pciVendorId?: string;
  pciDeviceId?: string;
  pciAddress?: string;
  discoverySource?: string;
  /**
   * Execution backends verified for this device by the worker's Docker/NVIDIA
   * probe. Absent or empty means discovery succeeded but execution did not.
   */
  executionBackends?: string[];
}

export interface GpuSummary {
  /** True when GPU hardware was detected (not a workload-readiness claim). */
  gpuAvailable: boolean;
  gpuName: string | null;
  gpuCount: number;
  /** Total VRAM in MiB, or null when any GPU's VRAM is unknown. */
  gpuMemoryMb: number | null;
  gpuDriverVersion: string | null;
  gpuSpecs: GpuInfo[] | undefined;
  /** True when every detected GPU has a known model, VRAM and driver. */
  gpuMetadataComplete: boolean;
  /**
   * True when at least one detected device advertises a verified execution
   * backend. Unsupported display adapters must not hide usable GPUs.
   */
  gpuExecutionReady: boolean;
}

function hasKnownMemory(gpu: GpuInfo): gpu is GpuInfo & { memoryMb: number } {
  return (
    typeof gpu.memoryMb === "number" &&
    Number.isFinite(gpu.memoryMb) &&
    gpu.memoryMb >= 0
  );
}

function hasName(gpu: GpuInfo): boolean {
  return typeof gpu.name === "string" && gpu.name.length > 0;
}

function hasDriverVersion(gpu: GpuInfo): boolean {
  return (
    typeof gpu.driverVersion === "string" && gpu.driverVersion.length > 0
  );
}

/**
 * Collapse the per-GPU list into the columns persisted on the Node row.
 *
 * `gpuMemoryMb` remains the total VRAM across all GPUs, but is only emitted
 * when every GPU reports a known value; otherwise it is null so partial
 * metadata is not presented as complete capacity.
 */
export function summarizeGpus(gpus: GpuInfo[] = []): GpuSummary {
  const allMemoryKnown = gpus.length > 0 && gpus.every(hasKnownMemory);
  const metadataComplete =
    gpus.length > 0 &&
    gpus.every(
      (gpu) => hasName(gpu) && hasKnownMemory(gpu) && hasDriverVersion(gpu),
    );

  return {
    gpuAvailable: gpus.length > 0,
    gpuName: gpus.find(hasName)?.name ?? null,
    gpuCount: gpus.length,
    gpuMemoryMb: allMemoryKnown
      ? gpus.reduce((total, gpu) => total + (gpu.memoryMb as number), 0)
      : null,
    gpuDriverVersion: gpus.find(hasDriverVersion)?.driverVersion ?? null,
    gpuSpecs: gpus.length > 0 ? gpus : undefined,
    gpuMetadataComplete: metadataComplete,
    // Readiness is a fleet-level convenience flag. Scheduling still matches
    // individual devices using their backend lists, so unsupported AMD/Intel
    // display adapters must not make a usable NVIDIA device disappear.
    gpuExecutionReady:
      gpus.length > 0 &&
      gpus.some(
        (gpu) =>
          Array.isArray(gpu.executionBackends) &&
          gpu.executionBackends.length > 0
      ),
  };
}
