/**
 * Real tests against the router's actual CORS handling — a live HTTP
 * server, real requests, not mocked internals. Run with:
 *   npx tsx apps/api/tests/cors.test.ts
 */
import assert from 'node:assert';
import http from 'node:http';
import { Router } from '../src/router.js';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`FAILED: ${name}`);
      throw err;
    }
  })();
}

async function withServer(envOrigins: string | undefined, fn: (port: number) => Promise<void>) {
  const prev = process.env.CORS_ORIGINS;
  if (envOrigins === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = envOrigins;

  const router = new Router();
  router.register('GET', '/ping', () => ({ status: 200, body: { ok: true } }));
  const server = http.createServer((req, res) => router.handleNode(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  try {
    await fn(port);
  } finally {
    server.close();
    if (prev === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prev;
  }
}

async function run() {
  await test('configured origin is reflected exactly, never a wildcard', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { headers: { origin: 'https://example.com' } });
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://example.com');
      assert.notStrictEqual(res.headers.get('access-control-allow-origin'), '*');
    })
  );

  await test('an origin not on the allowlist gets no CORS header', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { headers: { origin: 'https://evil.example' } });
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    })
  );

  await test('localhost is allowed by default when CORS_ORIGINS is unset', () =>
    withServer(undefined, async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { headers: { origin: 'http://localhost:5173' } });
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    })
  );

  await test('localhost default origin is REJECTED once CORS_ORIGINS is explicitly configured', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { headers: { origin: 'http://localhost:5173' } });
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    })
  );

  await test('a real OPTIONS preflight returns 204 with CORS headers, no body needed', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://example.com');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('DELETE'));
    })
  );

  await test('CORS headers are present on a 404, not just on success', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/does-not-exist`, { headers: { origin: 'https://example.com' } });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://example.com');
    })
  );

  await test('a request with no Origin header gets no CORS header and still succeeds (same-origin/non-browser callers)', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
      assert.strictEqual(res.status, 200);
    })
  );

  await test('preflight response includes a real Access-Control-Max-Age', () =>
    withServer('https://example.com', async (port) => {
      const res = await fetch(`http://localhost:${port}/ping`, { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
      assert.strictEqual(res.headers.get('access-control-max-age'), '600');
    })
  );

  await test('CORS works against the REAL production server (server.ts), not just a synthetic test route — a real chat GET carries the header', async () => {
    const { createServer } = await import('../src/server.js');
    const prev = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'https://real-frontend.example';
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/chat/main/messages`, {
        headers: { origin: 'https://real-frontend.example' },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://real-frontend.example');
    } finally {
      server.close();
      if (prev === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prev;
    }
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
