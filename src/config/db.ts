// Database Configuration
import { PrismaClient } from '@prisma/client';
import { logger } from '../libs/logger';

export const prisma = new PrismaClient({
    accelerateUrl: Bun.env.DATABASE_URL,
    log: ['query', 'info', 'warn', 'error'],
});

logger.info('Prisma client instantiated');
