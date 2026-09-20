/**
 * Real, end-to-end tests for the watchlist routes: starts the actual
 * apps/api HTTP server, signs in with a real Ed25519 keypair through
 * the real auth flow to get a genuine session token, then drives the
 * watchlist endpoints with real HTTP requests carrying it — proving
 * the whole chain (sign-in -> session -> authenticated CRUD) works
 * together, not just each piece in isolation.
 *
 * Run with: npx tsx apps/api/tests/watchlist-routes.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../src/server.js';
import { __resetForTests } from '../src/watchlist/watchlistStore.js';

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

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (num > 0n) {
    out = BASE58_ALPHABET[Number(num % 58n)] + out;
    num = num / 58n;
  }
  for (const b of buf) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

function makeWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { address: base58Encode(rawPublicKey), privateKey };
}

function sign(privateKey: crypto.KeyObject, message: string): string {
  return base58Encode(crypto.sign(null, Buffer.from(message, 'utf8'), privateKey));
}

async function signIn(base: string, wallet: ReturnType<typeof makeWallet>): Promise<string> {
  const challenge = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}&chain=solana`)).json();
  const signature = sign(wallet.privateKey, challenge.message);
  const sessionRes = await fetch(`${base}/api/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challenge.nonce, timestamp: challenge.timestamp, signature }),
  });
  const sessionBody = await sessionRes.json();
  return sessionBody.sessionToken;
}

async function run() {
  process.env.AUTH_SECRET = 'a-real-test-secret-for-watchlist-routes';
  __resetForTests();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const BASE = `http://localhost:${port}`;

  try {
    const walletA = makeWallet();
    const walletB = makeWallet();
    const tokenA = await signIn(BASE, walletA);
    const tokenB = await signIn(BASE, walletB);

    // --- No session at all: honestly rejected, not silently allowed ---
    const noAuthRes = await fetch(`${BASE}/api/v1/watchlist`);
    test('GET with no Authorization header is rejected with 401', noAuthRes.status === 401, String(noAuthRes.status));

    // --- Real add, authenticated ---
    const addRes = await fetch(`${BASE}/api/v1/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ value: 'SomeTokenMintAddress111' }),
    });
    const addBody = await addRes.json();
    test('POST with a valid session adds a real item, 201', addRes.status === 201 && addBody.item?.value === 'SomeTokenMintAddress111');

    // --- Real list, scoped to the authenticated wallet ---
    const listRes = await fetch(`${BASE}/api/v1/watchlist`, { headers: { authorization: `Bearer ${tokenA}` } });
    const listBody = await listRes.json();
    test('GET returns wallet A\'s own item', listRes.status === 200 && listBody.items.length === 1);

    // --- A DIFFERENT wallet's session sees an empty list — real isolation ---
    const listBRes = await fetch(`${BASE}/api/v1/watchlist`, { headers: { authorization: `Bearer ${tokenB}` } });
    const listBBody = await listBRes.json();
    test('GET for a different wallet\'s session sees NONE of wallet A\'s items', listBRes.status === 200 && listBBody.items.length === 0);

    // --- Wallet B cannot delete wallet A's item ---
    const itemId = addBody.item.id;
    const crossDeleteRes = await fetch(`${BASE}/api/v1/watchlist/${itemId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    test('DELETE by a DIFFERENT wallet\'s session is rejected with 403, not silently allowed', crossDeleteRes.status === 403, String(crossDeleteRes.status));

    // --- Confirm it's genuinely still there after the rejected attempt ---
    const stillThereRes = await fetch(`${BASE}/api/v1/watchlist`, { headers: { authorization: `Bearer ${tokenA}` } });
    const stillThereBody = await stillThereRes.json();
    test('the item still exists for its real owner after the rejected cross-wallet delete attempt', stillThereBody.items.length === 1);

    // --- The real owner CAN delete their own item ---
    const realDeleteRes = await fetch(`${BASE}/api/v1/watchlist/${itemId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    test('DELETE by the real owner succeeds', realDeleteRes.status === 200);

    const finalListRes = await fetch(`${BASE}/api/v1/watchlist`, { headers: { authorization: `Bearer ${tokenA}` } });
    const finalListBody = await finalListRes.json();
    test('the item is genuinely gone after the real owner deletes it', finalListBody.items.length === 0);

    console.log(`\n${passed} test(s) passed.`);
  } finally {
    server.close();
    delete process.env.AUTH_SECRET;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
