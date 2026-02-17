// src/config/db.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { logger } from "../libs/logger";

// Create connection pool
const pool = new Pool({
  connectionString: Bun.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create adapter
const adapter = new PrismaPg(pool);

// Create Prisma client with adapter
export const prisma = new PrismaClient({
  adapter,
  // log: ['query', 'info', 'warn', 'error'],
});

logger.info("Prisma client instantiated with pg adapter");
