-- Add new columns to Node (nullable for backward compatibility)
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "allocatableCpu" INTEGER;
ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "allocatableMemoryMb" INTEGER;

-- Make orgId and name nullable (existing rows keep values)
ALTER TABLE scheduler."Node" ALTER COLUMN "orgId" DROP NOT NULL;
ALTER TABLE scheduler."Node" ALTER COLUMN "name" DROP NOT NULL;

-- Migrate NodeStatus enum: create new type and migrate data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NodeStatus_new' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'scheduler')) THEN
    DROP TYPE scheduler."NodeStatus_new";
  END IF;
END $$;
CREATE TYPE scheduler."NodeStatus_new" AS ENUM ('UNPAIRED', 'PENDING', 'APPROVED', 'ACTIVE', 'DRAINING', 'REVOKED');

ALTER TABLE scheduler."Node" ADD COLUMN IF NOT EXISTS "status_new" scheduler."NodeStatus_new";

UPDATE scheduler."Node"
SET "status_new" = CASE
  WHEN "status"::text = 'REGISTERED' THEN 'PENDING'::scheduler."NodeStatus_new"
  WHEN "status"::text = 'HEALTHY' THEN 'ACTIVE'::scheduler."NodeStatus_new"
  WHEN "status"::text = 'UNHEALTHY' THEN 'ACTIVE'::scheduler."NodeStatus_new"
  WHEN "status"::text = 'DRAINING' THEN 'DRAINING'::scheduler."NodeStatus_new"
  WHEN "status"::text = 'OFFLINE' THEN 'REVOKED'::scheduler."NodeStatus_new"
  ELSE 'PENDING'::scheduler."NodeStatus_new"
END;

ALTER TABLE scheduler."Node" DROP COLUMN "status";
ALTER TABLE scheduler."Node" RENAME COLUMN "status_new" TO "status";
ALTER TABLE scheduler."Node" ALTER COLUMN "status" SET DEFAULT 'PENDING'::scheduler."NodeStatus_new";
DROP TYPE scheduler."NodeStatus";
ALTER TYPE scheduler."NodeStatus_new" RENAME TO "NodeStatus";
