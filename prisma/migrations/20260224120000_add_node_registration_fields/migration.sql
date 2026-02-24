-- Add columns used for secure HTTP-based worker registration
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "machineId" TEXT;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "agentVersion" TEXT;

CREATE INDEX IF NOT EXISTS "Node_machineId_idx" ON scheduler."Node" ("machineId");

