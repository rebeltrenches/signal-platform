/**
 * Real, end-to-end tests for the token routes: starts the actual
 * apps/api HTTP server on a real local port and drives it with real
 * HTTP requests — same "spin up the real thing" approach as chat.test.ts.
 *
 * Registration (audit item C2) runs through a real wallet sign-in
 * (Ed25519 signature over the server's challenge) and a fake Solana
 * JSON-RPC served over HTTP via SOLANA_RPC_URL, so the server's on-chain
 * creator check runs for real against known chain data.
 *
 * Run with: npx tsx apps/api/tests/token-routes.test.ts
 */
import { createServer } from '../src/server.js';
import { __resetForTests } from '../src/tokens/tokenStore.js';
import { makeWallet, signIn, randomSolanaAddress, startFakeSolanaRpcServer, type FakeMint } from './support/solanaTestKit.js';

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
  const savedEnv = { AUTH_SECRET: process.env.AUTH_SECRET, SOLANA_RPC_URL: process.env.SOLANA_RPC_URL };
  process.env.AUTH_SECRET = 'a-real-test-secret-for-token-routes';

  const mints = new Map<string, FakeMint>();
  const rpc = await startFakeSolanaRpcServer(mints);
  process.env.SOLANA_RPC_URL = rpc.url;

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const BASE = `http://localhost:${port}`;

  const creator = makeWallet();
  const stranger = makeWallet();
  const creatorSession = await signIn(BASE, creator);
  const strangerSession = await signIn(BASE, stranger);

  /** A mint that `wallet` created on the fake chain. */
  function createMint(wallet: { address: string }, decimals = 6): string {
    const address = randomSolanaAddress();
    mints.set(address, { decimals, initialAuthority: wallet.address, creationSigners: [wallet.address, address] });
    return address;
  }
  async function register(session: string | null, body: Record<string, unknown>) {
    const res = await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  try {
    const mintABC = createMint(creator);
    const tokenBody = { chain: 'solana', address: mintABC, name: 'Test Token', symbol: 'TT', decimals: 6 };

    // --- C2: a session is required ---
    const noSession = await register(null, tokenBody);
    test('registering without a session is rejected with 401', noSession.status === 401, String(noSession.status));
    const forgedSession = await register('not.a.session', tokenBody);
    test('registering with an invalid session is rejected with 401', forgedSession.status === 401, String(forgedSession.status));

    // --- C2: the creator must be the signed-in wallet AND have created the mint ---
    const claimedByStranger = await register(strangerSession, tokenBody);
    test("a signed-in wallet that did not create the mint is refused (403)", claimedByStranger.status === 403, String(claimedByStranger.status));
    test('the refusal says so', claimedByStranger.body.error === 'NOT_MINT_CREATOR');

    const spoofedField = await register(strangerSession, { ...tokenBody, creatorWalletAddress: creator.address });
    test('naming someone else as creatorWalletAddress is refused (403)', spoofedField.status === 403, String(spoofedField.status));

    const wrongDecimals = await register(creatorSession, { ...tokenBody, decimals: 9 });
    test('decimals that differ from the chain are refused (403)', wrongDecimals.status === 403, String(wrongDecimals.status));

    const noSuchMint = await register(creatorSession, { ...tokenBody, address: randomSolanaAddress() });
    test('a mint that does not exist on-chain is refused (403)', noSuchMint.status === 403, String(noSuchMint.status));

    // --- Registration ---
    const registered = await register(creatorSession, { ...tokenBody, creatorWalletAddress: creator.address });
    test('the real creator registering their mint returns 201', registered.status === 201, JSON.stringify(registered.body));
    test('the registered creator is the signed-in wallet', registered.body.token?.creatorWalletAddress === creator.address);
    test('the registered token is returned with the submitted fields', registered.body.token?.symbol === 'TT');

    // --- Chain casing regression: registered with lowercase 'solana',
    // must be findable via the uppercase-normalized lookup path. ---
    const lookupRes = await fetch(`${BASE}/api/v1/tokens/solana/${mintABC}`);
    const lookupBody: any = await lookupRes.json();
    test('a token registered as "solana" (lowercase) is findable via GET (case-normalization regression)', lookupRes.status === 200, String(lookupRes.status));
    test('the looked-up token matches what was registered', lookupBody.token?.address === mintABC);

    // --- Idempotent for the creator; blocked for everyone else ---
    const again = await register(creatorSession, tokenBody);
    test('the creator registering the same token again gets the same id, not a duplicate', again.status === 200 && again.body.token?.id === registered.body.token?.id, String(again.status));

    const takeover = await register(strangerSession, tokenBody);
    test('another wallet claiming an already-registered token is blocked with 409', takeover.status === 409, String(takeover.status));
    test('the 409 says TOKEN_ALREADY_REGISTERED', takeover.body.error === 'TOKEN_ALREADY_REGISTERED');
    const afterTakeover: any = await (await fetch(`${BASE}/api/v1/tokens/solana/${mintABC}`)).json();
    test('the registration still belongs to the original creator', afterTakeover.token?.creatorWalletAddress === creator.address);

    // --- Fails closed when the chain can't be asked ---
    const unverifiable = createMint(creator);
    rpc.setDown(true);
    const rpcDown = await register(creatorSession, { ...tokenBody, address: unverifiable });
    rpc.setDown(false);
    test('an RPC failure returns 503 and registers nothing', rpcDown.status === 503, String(rpcDown.status));
    delete process.env.SOLANA_RPC_URL;
    const noRpc = await register(creatorSession, { ...tokenBody, address: unverifiable });
    process.env.SOLANA_RPC_URL = rpc.url;
    test('no SOLANA_RPC_URL configured returns 503, never an unverified registration', noRpc.status === 503, String(noRpc.status));
    const stillMissing = await fetch(`${BASE}/api/v1/tokens/solana/${unverifiable}`);
    test('the unverified token was not registered', stillMissing.status === 404, String(stillMissing.status));

    // --- Honest 404, never a fabricated token ---
    const notFoundRes = await fetch(`${BASE}/api/v1/tokens/solana/NeverRegisteredMint`);
    const notFoundBody: any = await notFoundRes.json();
    test('an unregistered token address returns a real 404, not a fabricated result', notFoundRes.status === 404, String(notFoundRes.status));
    test('the 404 body clearly says NOT_FOUND', notFoundBody.error === 'NOT_FOUND');

    // --- Validation (checked before any RPC call) ---
    const missing = await register(creatorSession, { chain: 'solana' });
    test('registering with missing required fields is rejected with 400, not a 500', missing.status === 400, String(missing.status));
    const badAddress = await register(creatorSession, { ...tokenBody, address: 'example' });
    test('a non-Solana address is rejected with 400', badAddress.status === 400, String(badAddress.status));
    const otherChain = await register(creatorSession, { ...tokenBody, chain: 'base' });
    test('a non-Solana chain is rejected with 400', otherChain.status === 400, String(otherChain.status));

    // --- listMyTokensRoute ---
    const mineRes = await fetch(`${BASE}/api/v1/tokens/mine?creatorWalletAddress=${creator.address}`);
    const mineBody: any = await mineRes.json();
    test('listing a creator\'s tokens returns the one they registered', mineRes.status === 200 && mineBody.tokens?.length === 1, JSON.stringify(mineBody));

    const mineMissingRes = await fetch(`${BASE}/api/v1/tokens/mine`);
    test('listing tokens without a creatorWalletAddress query param is rejected with 400', mineMissingRes.status === 400, String(mineMissingRes.status));

    // --- GET /api/v1/tokens: public discovery listing, no auth needed ---
    const discoveryA = createMint(creator);
    const discoveryB = createMint(creator);
    await register(creatorSession, { chain: 'solana', address: discoveryA, name: 'Discovery A', symbol: 'DA', decimals: 6 });
    await new Promise((r) => setTimeout(r, 5));
    await register(creatorSession, { chain: 'solana', address: discoveryB, name: 'Discovery B', symbol: 'DB', decimals: 6 });

    const listRes = await fetch(`${BASE}/api/v1/tokens`); // deliberately no Authorization header at all
    const listBody: any = await listRes.json();
    test('GET /api/v1/tokens works with NO Authorization header — genuinely public', listRes.status === 200);
    test('the two just-registered tokens both appear', listBody.tokens.some((t: any) => t.address === discoveryA) && listBody.tokens.some((t: any) => t.address === discoveryB));
    test('newest-registered token sorts first', listBody.tokens[0].address === discoveryB);
    test('only real registration fields are present — no fabricated holderCount/volume anywhere in the response', !JSON.stringify(listBody).includes('holderCount') && !JSON.stringify(listBody).includes('volume'));

    const pagedRes = await fetch(`${BASE}/api/v1/tokens?limit=1`);
    const pagedBody: any = await pagedRes.json();
    test('limit=1 returns exactly 1 token with a real nextCursor', pagedBody.tokens.length === 1 && !!pagedBody.nextCursor);

    const badLimitRes = await fetch(`${BASE}/api/v1/tokens?limit=-5`);
    test('an invalid limit is rejected with 400, not silently clamped or ignored', badLimitRes.status === 400, String(badLimitRes.status));

    // --- GET /api/v1/search: public, unauthenticated, simple substring matching ---
    const dragon = createMint(creator);
    await register(creatorSession, { chain: 'solana', address: dragon, name: 'Dragon Coin', symbol: 'DRGN', decimals: 6 });

    const searchRes = await fetch(`${BASE}/api/v1/search?q=dragon`); // no Authorization header at all
    const searchBody: any = await searchRes.json();
    test('GET /api/v1/search works with NO Authorization header — genuinely public', searchRes.status === 200);
    test('a case-insensitive name search finds the real registered token', searchBody.tokens.some((t: any) => t.address === dragon));

    const symbolSearchRes = await fetch(`${BASE}/api/v1/search?q=DRGN`);
    const symbolSearchBody: any = await symbolSearchRes.json();
    test('searching by symbol also finds it', symbolSearchBody.tokens.some((t: any) => t.address === dragon));

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
    rpc.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
