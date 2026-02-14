// Database Configuration
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
    adapter: Bun.env.DATABASE_URL,
});

await prisma.