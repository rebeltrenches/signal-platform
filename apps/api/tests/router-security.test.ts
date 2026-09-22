import assert from 'node:assert/strict';
import http from 'node:http';
import { Router } from '../src/router.js';

async function run() {
  const router = new Router({ maxBodyBytes: 32, rateLimitMax: 3, rateLimitWindowMs: 60_000 });
  router.register('POST', '/echo', (req) => ({ status: 200, body: req.body }));
  router.register('GET', '/boom', () => { throw new Error('database password must not leak'); });
  const server = http.createServer((req, res) => router.handleNode(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const valid = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(valid.headers.get('x-frame-options'), 'DENY');
    assert.equal(valid.headers.get('cache-control'), 'no-store');

    const tooLarge = await fetch(`${base}/echo`, { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(40) }) });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json() as any).error, 'PAYLOAD_TOO_LARGE');

    const internal = await fetch(`${base}/boom`);
    assert.equal(internal.status, 500);
    const internalBody = await internal.text();
    assert.doesNotMatch(internalBody, /database password/i);

    const limited = await fetch(`${base}/missing`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await limited.json() as any).error, 'RATE_LIMITED');

    console.log('  ok  - applies security headers to API responses');
    console.log('  ok  - rejects oversized request bodies');
    console.log('  ok  - does not expose internal exception messages');
    console.log('  ok  - rate limits repeated requests by client address');
    console.log('\n4 test(s) passed.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
