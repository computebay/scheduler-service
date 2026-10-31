-- Whole-GPU allocations. A job is allocated specific devices; the unique jobId
-- constraint prevents duplicate scheduling from creating two allocations.
DO $$
BEGIN
  CREATE TYPE scheduler."GpuAllocationStatus" AS ENUM ('ACTIVE', 'RELEASED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS scheduler."GpuAllocation" (
  "id"            TEXT NOT NULL,
  "jobId"         TEXT NOT NULL,
  "nodeId"        TEXT NOT NULL,
  "vendor"        TEXT NOT NULL,
  "backend"       TEXT NOT NULL,
  "count"         INTEGER NOT NULL,
  "devices"       JSONB NOT NULL,
  "deviceKeys"    JSONB NOT NULL,
  "status"        scheduler."GpuAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt"    TIMESTAMP(3),
  "releaseReason" TEXT,

  CONSTRAINT "GpuAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GpuAllocation_jobId_key"
  ON scheduler."GpuAllocation"("jobId");

CREATE INDEX IF NOT EXISTS "GpuAllocation_nodeId_idx"
  ON scheduler."GpuAllocation"("nodeId");

CREATE INDEX IF NOT EXISTS "GpuAllocation_status_idx"
  ON scheduler."GpuAllocation"("status");
