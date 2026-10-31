import type { GpuInfo } from "@/utils/gpu";

export const GPU_VENDORS = ["nvidia", "amd", "intel"] as const;
export const GPU_BACKENDS = ["cuda", "nvenc"] as const;

export type GpuVendor = (typeof GPU_VENDORS)[number];
export type GpuBackend = (typeof GPU_BACKENDS)[number];

/**
 * The only vendor with a verified Docker execution backend in this phase.
 * Other vendors are valid contract values but the scheduler rejects them with
 * an explicit reason rather than scheduling a job that cannot run.
 */
export const EXECUTABLE_GPU_VENDOR: GpuVendor = "nvidia";

const BACKEND_VENDOR: Record<GpuBackend, GpuVendor> = {
  cuda: "nvidia",
  nvenc: "nvidia",
};

/** Canonical GPU requirement after normalizing legacy `"any" | "none"`. */
export interface GpuRequirement {
  required: true;
  count: number;
  vendor?: GpuVendor;
  minMemoryMb?: number;
  backend?: GpuBackend;
}

/** A single device selected by the scheduler. */
export interface GpuAssignmentDevice {
  /** Stable device identity when the worker reported one (NVIDIA UUID/PCI). */
  id?: string;
  /** Index at scheduling time. The worker must re-resolve when an id exists. */
  index: number;
  vendor: GpuVendor;
  pciAddress?: string;
}

/** Payload added to `job.scheduled` for GPU jobs. */
export interface GpuAssignment {
  vendor: GpuVendor;
  backend: GpuBackend;
  count: number;
  devices: GpuAssignmentDevice[];
}

/** In-memory + persisted allocation record. */
export interface GpuAllocationRecord extends GpuAssignment {
  jobId: string;
  nodeId: string;
  /** Stable keys used for local/global exclusivity. */
  deviceKeys: string[];
  createdAt: number;
}

export type GpuPlanFailureCode =
  | "GPU_REQUIREMENT_INVALID"
  | "GPU_VENDOR_UNSUPPORTED"
  | "GPU_BACKEND_UNSUPPORTED"
  | "GPU_HARDWARE_MISSING"
  | "GPU_EXECUTION_UNVERIFIED"
  | "GPU_VRAM_INSUFFICIENT"
  | "GPU_CAPACITY_EXHAUSTED";

export interface GpuPlanFailure {
  code: GpuPlanFailureCode;
  message: string;
}

export function normalizeGpuVendor(
  vendor: string | undefined
): GpuVendor | undefined {
  if (!vendor) return undefined;
  const value = vendor.trim().toLowerCase();
  if (value === "nvidia") return "nvidia";
  if (value === "amd" || value === "advanced micro devices") return "amd";
  if (value === "intel") return "intel";
  return undefined;
}

export function normalizeGpuBackend(
  backend: string | undefined
): GpuBackend | undefined {
  if (!backend) return undefined;
  const value = backend.trim().toLowerCase();
  if (value === "cuda") return "cuda";
  if (value === "nvenc") return "nvenc";
  return undefined;
}

/** Vendor of a discovered device, preferring the explicit report. */
export function gpuVendorOf(gpu: GpuInfo): GpuVendor | undefined {
  const vendor = normalizeGpuVendor(gpu.vendor);
  if (vendor) return vendor;
  switch (gpu.pciVendorId?.trim().toLowerCase()) {
    case "10de":
      return "nvidia";
    case "1002":
      return "amd";
    case "8086":
      return "intel";
    default:
      return undefined;
  }
}

/**
 * Stable key when the device has one; conservative index fallback otherwise.
 * Index keys are never restored across scheduler restarts.
 */
export function gpuDeviceKey(gpu: GpuInfo): {
  key: string;
  stable: boolean;
} {
  if (gpu.id && gpu.id.trim().length > 0) {
    return { key: `id:${gpu.id.trim()}`, stable: true };
  }
  if (gpu.pciAddress && gpu.pciAddress.trim().length > 0) {
    return {
      key: `pci:${gpu.pciAddress.trim().toLowerCase()}`,
      stable: true,
    };
  }
  return { key: `index:${gpu.index}`, stable: false };
}

export interface GpuRequirementParseResult {
  requirement: GpuRequirement | null;
  error?: string;
}

/**
 * Normalize the public `resources.gpu` contract.
 *
 * Legacy values are still accepted: `"any"` means one GPU, `"none"` (or an
 * omitted field) means CPU-only. The object form is validated strictly enough
 * that invalid values never silently degrade into CPU-only execution.
 */
export function parseGpuRequirement(
  raw: unknown
): GpuRequirementParseResult {
  if (raw === undefined || raw === null || raw === "none") {
    return { requirement: null };
  }
  if (raw === "any") {
    return { requirement: { required: true, count: 1 } };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      requirement: null,
      error: "resources.gpu must be 'any', 'none', or an object",
    };
  }

  const value = raw as Record<string, unknown>;
  if (typeof value.required !== "boolean") {
    return {
      requirement: null,
      error: "resources.gpu.required must be a boolean",
    };
  }
  if (!value.required) {
    const extra = ["count", "vendor", "minMemoryMb", "backend"].find(
      (key) => value[key] !== undefined
    );
    if (extra) {
      return {
        requirement: null,
        error: `resources.gpu.${extra} is only valid when required is true`,
      };
    }
    return { requirement: null };
  }

  const count = value.count === undefined ? 1 : value.count;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 64
  ) {
    return {
      requirement: null,
      error: "resources.gpu.count must be an integer between 1 and 64",
    };
  }

  let vendor: GpuVendor | undefined;
  if (value.vendor !== undefined) {
    if (typeof value.vendor !== "string") {
      return {
        requirement: null,
        error: "resources.gpu.vendor must be a string",
      };
    }
    vendor = normalizeGpuVendor(value.vendor);
    if (!vendor) {
      return {
        requirement: null,
        error: "resources.gpu.vendor must be one of: nvidia, amd, intel",
      };
    }
  }

  let backend: GpuBackend | undefined;
  if (value.backend !== undefined) {
    if (typeof value.backend !== "string") {
      return {
        requirement: null,
        error: "resources.gpu.backend must be a string",
      };
    }
    backend = normalizeGpuBackend(value.backend);
    if (!backend) {
      return {
        requirement: null,
        error: "resources.gpu.backend must be one of: cuda, nvenc",
      };
    }
  }

  if (backend && vendor && BACKEND_VENDOR[backend] !== vendor) {
    return {
      requirement: null,
      error: `resources.gpu.backend '${backend}' is not supported by vendor '${vendor}'`,
    };
  }

  let minMemoryMb: number | undefined;
  if (value.minMemoryMb !== undefined) {
    if (
      typeof value.minMemoryMb !== "number" ||
      !Number.isInteger(value.minMemoryMb) ||
      value.minMemoryMb <= 0
    ) {
      return {
        requirement: null,
        error: "resources.gpu.minMemoryMb must be a positive integer",
      };
    }
    minMemoryMb = value.minMemoryMb;
  }

  const resolvedVendor =
    vendor ?? (backend ? BACKEND_VENDOR[backend] : undefined);

  return {
    requirement: {
      required: true,
      count,
      ...(resolvedVendor ? { vendor: resolvedVendor } : {}),
      ...(minMemoryMb !== undefined ? { minMemoryMb } : {}),
      ...(backend ? { backend } : {}),
    },
  };
}
