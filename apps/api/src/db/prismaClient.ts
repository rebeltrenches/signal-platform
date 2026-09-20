/**
 * The single, shared PrismaClient instance for the whole process.
 * A shared client avoids creating multiple database connection pools.
 *
 * The dynamic import defers resolution of @prisma/client until runtime,
 * after Prisma Client has been generated during the Render build.
 */

let clientPromise: Promise<any> | null = null;

export function getSharedPrismaClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = import('@prisma/client').then(({ PrismaClient }) => {
      const client = new PrismaClient();
      return client;
    });
  }
  return clientPromise;
}

/** Test-only. Never called from any real route handler or startup path. */
export function __resetSharedClientForTests(): void {
  clientPromise = null;
}
