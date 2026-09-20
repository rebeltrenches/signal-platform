import type { Handler } from '../router.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

export const getHealth: Handler = () => ({
  status: 200,
  body: { status: 'ok', service: 'api', timestamp: new Date().toISOString() },
});

/**
 * Real database health check. This performs a minimal read-only query
 * against the same shared Prisma client used by the persistent stores.
 * It never exposes DATABASE_URL or other connection details.
 */
export const getHealthDatabase: Handler = async () => {
  if (!process.env.DATABASE_URL) {
    return {
      status: 503,
      body: {
        status: 'not_configured',
        message: 'DATABASE_URL is not configured.',
      },
    };
  }

  try {
    const prisma = await getSharedPrismaClient();
    await prisma.$queryRawUnsafe('SELECT 1');

    return {
      status: 200,
      body: {
        status: 'ok',
        database: 'postgresql',
      },
    };
  } catch (err) {
    console.error('[health/database] database check failed:', err);
    return {
      status: 503,
      body: {
        status: 'unavailable',
        message: 'Database connection check failed.',
      },
    };
  }
};
