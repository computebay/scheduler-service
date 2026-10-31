import type { NodeState } from "./cluster.state";
import type { GpuInfo } from "@/utils/gpu";
import {
  EXECUTABLE_GPU_VENDOR,
  gpuDeviceKey,
  gpuVendorOf,
  type GpuAllocationRecord,
  type GpuAssignmentDevice,
  type GpuBackend,
  type GpuPlanFailure,
  type GpuRequirement,
} from "./gpu.types";

export interface GpuPlanResult {
  /** Null for CPU-only jobs. */
  allocation: GpuAllocationRecord | null;
  failure?: GpuPlanFailure;
}

function supportsBackend(gpu: GpuInfo, backend: GpuBackend): boolean {
  return gpu.executionBackends?.includes(backend) === true;
}

function toAssignmentDevice(gpu: GpuInfo): GpuAssignmentDevice {
  return {
    ...(gpu.id ? { id: gpu.id } : {}),
    index: gpu.index,
    vendor: "nvidia",
    ...(gpu.pciAddress
      ? { pciAddress: gpu.pciAddress.toLowerCase() }
      : {}),
  };
}

/**
 * Select whole NVIDIA devices on one node for a GPU job.
 *
 * This function is pure: it receives the node's verified inventory and the
 * set of device keys already reserved. It never treats `gpuAvailable`, a model
 * name, or an unverified device as proof that Docker can execute on it, and it
 * never lets an unknown VRAM value satisfy a VRAM requirement.
 */
export function planNodeGpuAllocation(
  node: NodeState,
  jobId: string,
  requirement: GpuRequirement | null,
  reservedKeys: ReadonlySet<string>
): GpuPlanResult {
  if (!requirement) return { allocation: null };

  if (
    requirement.vendor !== undefined &&
    requirement.vendor !== EXECUTABLE_GPU_VENDOR
  ) {
    return {
      allocation: null,
      failure: {
        code: "GPU_VENDOR_UNSUPPORTED",
        message: `GPU vendor '${requirement.vendor}' has no Docker execution backend (only nvidia is supported)`,
      },
    };
  }

  const specs = node.gpuSpecs ?? [];
  if (specs.length === 0) {
    return {
      allocation: null,
      failure: {
        code: "GPU_HARDWARE_MISSING",
        message: "Node reports no GPU hardware",
      },
    };
  }

  const nvidia = specs.filter(
    (gpu) => gpuVendorOf(gpu) === EXECUTABLE_GPU_VENDOR
  );
  if (nvidia.length === 0) {
    return {
      allocation: null,
      failure: {
        code: "GPU_HARDWARE_MISSING",
        message: "Node has no NVIDIA GPU hardware",
      },
    };
  }

  let candidates = nvidia;
  if (requirement.minMemoryMb !== undefined) {
    const minMemoryMb = requirement.minMemoryMb;
    candidates = nvidia.filter(
      (gpu) =>
        typeof gpu.memoryMb === "number" && gpu.memoryMb >= minMemoryMb
    );
    if (candidates.length === 0) {
      const unknownVram = nvidia.some(
        (gpu) => typeof gpu.memoryMb !== "number"
      );
      return {
        allocation: null,
        failure: {
          code: "GPU_VRAM_INSUFFICIENT",
          message: unknownVram
            ? `No NVIDIA GPU has verified VRAM of at least ${minMemoryMb} MiB (unknown VRAM does not satisfy the requirement)`
            : `No NVIDIA GPU has at least ${minMemoryMb} MiB of VRAM`,
        },
      };
    }
  }

  const backendOrder: GpuBackend[] = requirement.backend
    ? [requirement.backend]
    : ["cuda", "nvenc"];

  let backend: GpuBackend | undefined;
  let eligible: GpuInfo[] = [];

  for (const candidate of backendOrder) {
    const available = candidates.filter((gpu) => {
      if (!supportsBackend(gpu, candidate)) return false;
      return !reservedKeys.has(gpuDeviceKey(gpu).key);
    });
    if (available.length >= requirement.count) {
      backend = candidate;
      eligible = available;
      break;
    }
  }

  if (!backend) {
    const hasVerifiedBackend = candidates.some(
      (gpu) => (gpu.executionBackends?.length ?? 0) > 0
    );
    if (!hasVerifiedBackend) {
      return {
        allocation: null,
        failure: {
          code: "GPU_EXECUTION_UNVERIFIED",
          message:
            "Node reports GPU hardware but no verified Docker execution backend",
        },
      };
    }

    if (requirement.backend) {
      const supportsRequested = candidates.some((gpu) =>
        supportsBackend(gpu, requirement.backend as GpuBackend)
      );
      if (!supportsRequested) {
        return {
          allocation: null,
          failure: {
            code: "GPU_BACKEND_UNSUPPORTED",
            message: `No NVIDIA GPU on this node supports the '${requirement.backend}' backend`,
          },
        };
      }
    }

    return {
      allocation: null,
      failure: {
        code: "GPU_CAPACITY_EXHAUSTED",
        message: `Node has fewer than ${requirement.count} free GPU device(s) matching the requirement`,
      },
    };
  }

  const selected = [...eligible]
    .sort((a, b) => a.index - b.index)
    .slice(0, requirement.count);

  const deviceKeys: string[] = [];
  const seen = new Set<string>();
  for (const gpu of selected) {
    const { key } = gpuDeviceKey(gpu);
    if (seen.has(key)) {
      return {
        allocation: null,
        failure: {
          code: "GPU_CAPACITY_EXHAUSTED",
          message: "Node GPU inventory contains duplicate device identities",
        },
      };
    }
    seen.add(key);
    deviceKeys.push(key);
  }

  return {
    allocation: {
      jobId,
      nodeId: node.nodeId,
      vendor: "nvidia",
      backend,
      count: requirement.count,
      devices: selected.map(toAssignmentDevice),
      deviceKeys,
      createdAt: Date.now(),
    },
  };
}

/** Public assignment shape sent to the worker (no internal keys/node id). */
export function toGpuAssignment(
  allocation: GpuAllocationRecord
): {
  vendor: GpuAllocationRecord["vendor"];
  backend: GpuAllocationRecord["backend"];
  count: number;
  devices: GpuAssignmentDevice[];
} {
  return {
    vendor: allocation.vendor,
    backend: allocation.backend,
    count: allocation.count,
    devices: allocation.devices.map((device) => ({ ...device })),
  };
}
