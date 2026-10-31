# Scheduler Service

A distributed job scheduler service built with TypeScript, Bun, Prisma, and RabbitMQ.

## Features

- **Job Scheduling**: Schedule jobs across a distributed cluster of nodes
- **Resource Management**: Manage CPU and memory resources across nodes
- **GPU-Aware Scheduling**: Schedule NVIDIA GPU jobs only onto nodes with
  verified Docker execution readiness (see "GPU scheduling" below)
- **Heartbeat Monitoring**: Monitor node health through heartbeat events
- **Event-Driven**: Built on RabbitMQ for event-driven architecture
- **Placement Algorithm**: Intelligent job placement based on available resources

## Architecture

The service is organized into:

- **Consumers**: Message queue consumers for events (job creation, heartbeats, node registration)
- **Producers**: Event publishers for scheduler events
- **Config**: Configuration management for database, RabbitMQ, and environment
- **Libs**: Reusable libraries for Prisma, RabbitMQ, and logging
- **Domain**: Core business logic (cluster state, placement algorithm, resource reservation)
- **Services**: Business logic services for scheduling operations
- **Types**: TypeScript type definitions
- **Utils**: Utility functions

## Prerequisites

- [Bun](https://bun.sh/)
- PostgreSQL
- RabbitMQ
- Node.js 18+ (if not using Bun runtime)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

3. Setup database:

```bash
bun run prisma:migrate
```

4. Start the service:

```bash
bun run dev
```

## Development

- Build: `bun run build`
- Test: `bun run test`
- Lint: `bun run lint`
- Prisma Studio: `bun run prisma:studio`

## GPU scheduling

The scheduler extends the existing least-allocated-fit placement with an
explicit, conservative GPU stage (`src/domain/gpu.scheduling.ts`,
`src/domain/gpu.types.ts`):

- **Requirements**: `job.created` may carry `resources.gpu` as legacy
  `"any"`/`"none"` or `{ required: true, count?, vendor?, minMemoryMb?,
  backend? }`. Invalid counts/VRAM/vendor/backend values are audited as
  `REJECTED_NO_CAPACITY` with a `GPU_*` reason and never dispatched.
- **Readiness**: a device is eligible only if the worker reported a verified
  execution backend for it (`executionBackends`, e.g. `["cuda","nvenc"]`,
  produced by the worker's Docker/NVIDIA readiness probe). `gpuAvailable`,
  device nodes or a model name alone are never treated as readiness.
- **VRAM**: `minMemoryMb` is satisfied only by devices with a *known* VRAM of
  at least that size; unknown VRAM never satisfies the requirement and no
  VRAM value is ever fabricated.
- **Vendors**: only `nvidia` (`cuda`/`nvenc`) has an execution backend in this
  phase. `amd`/`intel` requirements are valid contract values but are rejected
  with `GPU_VENDOR_UNSUPPORTED`.
- **Whole-GPU allocation**: each job exclusively owns whole physical devices,
  tracked by stable identity (`id:<UUID>` / `pci:<address>`; an `index:<n>`
  key is a conservative fallback used only when no stable identity exists).
  Allocations are stored in-memory per node **and** persisted in the
  `GpuAllocation` table (`ACTIVE`/`RELEASED`).

### Allocation lifecycle

- **Reserve**: on `job.scheduled`, devices are reserved in cluster state and
  persisted as `ACTIVE`; the assignment (`vendor`, `backend`, `count`,
  `devices[]`) is attached to the `job.scheduled` payload.
- **Duplicate delivery**: a redelivered `job.created` for a job that already
  has an allocation reuses it instead of allocating again.
- **Release**: worker terminal events (`job.completed`, `job.failed`,
  `job.timeout`, `job.cancelled`, `service.failed`, `service.stopped`) and
  job-service status events (`job.completed`, `job.failed`, `job.cancelled`,
  `job.timeout`) release the allocation; releases are idempotent.
- **Node loss**: heartbeat-timeout (`UNHEALTHY`) nodes and workers whose
  reported GPUs lose their verified backends have all allocations released.
- **Restart reconciliation**: on startup, `ACTIVE` allocations are reloaded;
  allocations with index-only identity, or whose devices are missing from the
  node's hydrated inventory, are released instead of being re-reserved.

## Docker

Build and run with Docker:

```bash
docker build -t scheduler-service .
docker run -p 3000:3000 scheduler-service
```

## License

MIT
