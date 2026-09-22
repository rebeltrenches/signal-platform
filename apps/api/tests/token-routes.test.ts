/**
 * Real, end-to-end tests for the token routes: starts the actual
 * apps/api HTTP server on a real local port and drives it with real
 * HTTP requests — same "spin up the real thing" approach as chat.test.ts.
 *
 * Run with: npx tsx apps/api/tests/token-routes.test.ts
 */
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { __resetForTests } from '../src/tokens/tokenStore.js';

let passed = 0;
function test(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok  - ${name}`);
    passed++;
  } else {
    console.log(`  FAIL - ${name}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  }
}

async function run() {
  __resetForTests();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const BASE = `http://localhost:${port}`;

  try {
    // --- Registration ---
    const registerRes = await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'MintABC', name: 'Test Token', symbol: 'TT', decimals: 6, creatorWalletAddress: 'CreatorABC' }),
    });
    const registerBody: any = await registerRes.json();
    test('registering a new token returns 201', registerRes.status === 201, String(registerRes.status));
    test('the registered token is returned with the submitted fields', registerBody.token?.symbol === 'TT');

    // --- Chain casing regression: registered with lowercase 'solana',
    // must be findable via the uppercase-normalized lookup path. This
    // is the exact bug caught and fixed during implementation. ---
    const lookupRes = await fetch(`${BASE}/api/v1/tokens/solana/MintABC`);
    const lookupBody: any = await lookupRes.json();
    test('a token registered as "solana" (lowercase) is findable via GET (case-normalization regression)', lookupRes.status === 200, String(lookupRes.status));
    test('the looked-up token matches what was registered', lookupBody.token?.address === 'MintABC');

    // --- Idempotency over HTTP ---
    const secondRegisterRes = await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'MintABC', name: 'Test Token', symbol: 'TT', decimals: 6, creatorWalletAddress: 'CreatorABC' }),
    });
    const secondBody: any = await secondRegisterRes.json();
    test('registering the same token twice returns the same id, not a duplicate', secondBody.token?.id === registerBody.token?.id);

    // --- Honest 404, never a fabricated token ---
    const notFoundRes = await fetch(`${BASE}/api/v1/tokens/solana/NeverRegisteredMint`);
    const notFoundBody: any = await notFoundRes.json();
    test('an unregistered token address returns a real 404, not a fabricated result', notFoundRes.status === 404, String(notFoundRes.status));
    test('the 404 body clearly says NOT_FOUND', notFoundBody.error === 'NOT_FOUND');

    // --- Validation ---
    const badRes = await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana' }), // missing required fields
    });
    test('registering with missing required fields is rejected with 400, not a 500', badRes.status === 400, String(badRes.status));

    // --- listMyTokensRoute ---
    const mineRes = await fetch(`${BASE}/api/v1/tokens/mine?creatorWalletAddress=CreatorABC`);
    const mineBody: any = await mineRes.json();
    test('listing a creator\'s tokens returns the one they registered', mineRes.status === 200 && mineBody.tokens?.length === 1, JSON.stringify(mineBody));

    const mineMissingRes = await fetch(`${BASE}/api/v1/tokens/mine`);
    test('listing tokens without a creatorWalletAddress query param is rejected with 400', mineMissingRes.status === 400, String(mineMissingRes.status));

    // --- GET /api/v1/tokens: public discovery listing, no auth needed ---
    await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'DiscoveryMintA', name: 'Discovery A', symbol: 'DA', decimals: 6, creatorWalletAddress: 'DiscoveryCreator' }),
    });
    await new Promise((r) => setTimeout(r, 5));
    await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'DiscoveryMintB', name: 'Discovery B', symbol: 'DB', decimals: 6, creatorWalletAddress: 'DiscoveryCreator' }),
    });

    const listRes = await fetch(`${BASE}/api/v1/tokens`); // deliberately no Authorization header at all
    const listBody: any = await listRes.json();
    test('GET /api/v1/tokens works with NO Authorization header — genuinely public', listRes.status === 200);
    test('the two just-registered tokens both appear', listBody.tokens.some((t: any) => t.address === 'DiscoveryMintA') && listBody.tokens.some((t: any) => t.address === 'DiscoveryMintB'));
    test('newest-registered token sorts first', listBody.tokens[0].address === 'DiscoveryMintB');
    test('only real registration fields are present — no fabricated holderCount/volume anywhere in the response', !JSON.stringify(listBody).includes('holderCount') && !JSON.stringify(listBody).includes('volume'));

    const pagedRes = await fetch(`${BASE}/api/v1/tokens?limit=1`);
    const pagedBody: any = await pagedRes.json();
    test('limit=1 returns exactly 1 token with a real nextCursor', pagedBody.tokens.length === 1 && !!pagedBody.nextCursor);

    const badLimitRes = await fetch(`${BASE}/api/v1/tokens?limit=-5`);
    test('an invalid limit is rejected with 400, not silently clamped or ignored', badLimitRes.status === 400, String(badLimitRes.status));

    // --- GET /api/v1/search: public, unauthenticated, simple substring matching ---
    await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'SearchableDragonMint', name: 'Dragon Coin', symbol: 'DRGN', decimals: 6, creatorWalletAddress: 'SearchCreator' }),
    });

    const searchRes = await fetch(`${BASE}/api/v1/search?q=dragon`); // no Authorization header at all
    const searchBody: any = await searchRes.json();
    test('GET /api/v1/search works with NO Authorization header — genuinely public', searchRes.status === 200);
    test('a case-insensitive name search finds the real registered token', searchBody.tokens.some((t: any) => t.address === 'SearchableDragonMint'));

    const symbolSearchRes = await fetch(`${BASE}/api/v1/search?q=DRGN`);
    const symbolSearchBody: any = await symbolSearchRes.json();
    test('searching by symbol also finds it', symbolSearchBody.tokens.some((t: any) => t.address === 'SearchableDragonMint'));

    const noMatchRes = await fetch(`${BASE}/api/v1/search?q=DefinitelyNotRegisteredZZZ`);
    const noMatchBody: any = await noMatchRes.json();
    test('a genuinely non-matching search returns an empty array, not an error or fabricated result', noMatchRes.status === 200 && noMatchBody.tokens.length === 0);

    const emptyQueryRes = await fetch(`${BASE}/api/v1/search?q=`);
    test('an empty q param is rejected with 400', emptyQueryRes.status === 400, String(emptyQueryRes.status));

    const missingQueryRes = await fetch(`${BASE}/api/v1/search`);
    test('a missing q param is rejected with 400', missingQueryRes.status === 400, String(missingQueryRes.status));

    console.log(`\n${passed} test(s) passed.`);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
