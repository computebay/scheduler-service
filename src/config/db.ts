// src/config/db.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getLogger } from "@computebay/observability";

const logger = getLogger();

// Create connection pool
const pool = new Pool({
  connectionString: Bun.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create adapter
const adapter = new PrismaPg(pool);

// Create Prisma client with adapter
export const prisma = new PrismaClient({
  adapter,
});

logger.info("Prisma client instantiated with pg adapter");
