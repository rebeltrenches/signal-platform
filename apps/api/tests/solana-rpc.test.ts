import assert from 'node:assert';
import { createServer } from '../src/server.js';
import { SOLANA_LAUNCH_RPC_METHODS } from '../src/routes/solanaRpc.js';

const expectedMethods = [
  'getBlockHeight',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getSignatureStatuses',
  'sendTransaction',
  'simulateTransaction',
];

async function run() {
  const previousRpcUrl = process.env.SOLANA_RPC_URL;
  const previousOrigins = process.env.CORS_ORIGINS;
  const originalFetch = globalThis.fetch;
  process.env.SOLANA_RPC_URL = 'https://rpc.example.test';
  process.env.CORS_ORIGINS = 'https://signal-platform.pages.dev';

  const upstreamMethods: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    upstreamMethods.push(body.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const endpoint = `http://localhost:${port}/api/solana/rpc`;
  try {
    assert.deepStrictEqual([...SOLANA_LAUNCH_RPC_METHODS].sort(), expectedMethods.sort());

    for (const method of expectedMethods) {
      const response = await originalFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://signal-platform.pages.dev' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      });
      assert.strictEqual(response.status, 200, method);
      assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://signal-platform.pages.dev');
    }

    const denied = await originalFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://signal-platform.pages.dev' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getBalance', params: [] }),
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.headers.get('access-control-allow-origin'), 'https://signal-platform.pages.dev');

    const preflight = await originalFetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://signal-platform.pages.dev',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.strictEqual(preflight.status, 204);
    assert.strictEqual(preflight.headers.get('access-control-allow-origin'), 'https://signal-platform.pages.dev');
    assert.ok(preflight.headers.get('access-control-allow-methods')?.includes('POST'));
    assert.ok(preflight.headers.get('access-control-allow-headers')?.includes('content-type'));

    assert.deepStrictEqual(upstreamMethods.sort(), expectedMethods.sort());
    console.log('8 tests passed: exact launch RPC allowlist (6), rejection (1), Cloudflare-origin CORS/preflight (1).');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    if (previousRpcUrl === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = previousRpcUrl;
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
