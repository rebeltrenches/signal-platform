/**
 * The single, shared PrismaClient instance for the whole process.
 * A shared client avoids creating multiple database connection pools.
 *
 * The dynamic imports defer resolution of Prisma packages until runtime,
 * after Prisma Client has been generated during the Render build.
 */

let clientPromise: Promise<any> | null = null;

export function getSharedPrismaClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]).then(([{ PrismaClient }, { PrismaPg }]) => {
      const connectionString = process.env.DATABASE_URL;

      if (!connectionString) {
        throw new Error('DATABASE_URL is required for database storage.');
      }

      const adapter = new PrismaPg({ connectionString });
      const client = new PrismaClient({ adapter });

      return client;
    });
  }

  return clientPromise;
}

/** Test-only. Never called from any real route handler or startup path. */
export function __resetSharedClientForTests(): void {
  clientPromise = null;
}
