-- Distinguish GPU hardware detection from metadata completeness and workload
-- execution readiness. Both default to false so existing rows stay valid.
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuMetadataComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuExecutionReady" BOOLEAN NOT NULL DEFAULT false;
