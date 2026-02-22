-- Revert NodeStatus to simple: REGISTERED, HEALTHY, UNHEALTHY, DRAINING, OFFLINE
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = 'NodeStatus_legacy' AND n.nspname = 'scheduler') THEN
    DROP TYPE scheduler."NodeStatus_legacy";
  END IF;
END $$;

CREATE TYPE scheduler."NodeStatus_legacy" AS ENUM ('REGISTERED', 'HEALTHY', 'UNHEALTHY', 'DRAINING', 'OFFLINE');

ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "status_legacy" scheduler."NodeStatus_legacy";

UPDATE scheduler."Node"
SET "status_legacy" = CASE
  WHEN "status"::text IN ('PENDING', 'UNPAIRED') THEN 'REGISTERED'::scheduler."NodeStatus_legacy"
  WHEN "status"::text IN ('APPROVED', 'ACTIVE') THEN 'HEALTHY'::scheduler."NodeStatus_legacy"
  WHEN "status"::text = 'DRAINING' THEN 'DRAINING'::scheduler."NodeStatus_legacy"
  WHEN "status"::text = 'REVOKED' THEN 'OFFLINE'::scheduler."NodeStatus_legacy"
  ELSE 'REGISTERED'::scheduler."NodeStatus_legacy"
END;

ALTER TABLE scheduler."Node" DROP COLUMN "status";
ALTER TABLE scheduler."Node" RENAME COLUMN "status_legacy" TO "status";
ALTER TABLE scheduler."Node" ALTER COLUMN "status" SET DEFAULT 'REGISTERED'::scheduler."NodeStatus_legacy";
DROP TYPE scheduler."NodeStatus";
ALTER TYPE scheduler."NodeStatus_legacy" RENAME TO "NodeStatus";
