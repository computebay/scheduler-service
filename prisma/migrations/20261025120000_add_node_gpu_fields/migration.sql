-- GPU discovery fields reported by the worker agent at registration.
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuName" TEXT;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuMemoryMb" INTEGER;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuDriverVersion" TEXT;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "gpuSpecs" JSONB;

CREATE INDEX IF NOT EXISTS "Node_gpuAvailable_idx" ON scheduler."Node" ("gpuAvailable");
