/**
 * Real, end-to-end tests for the alert routes: starts the actual
 * apps/api HTTP server, registers a real token via the real
 * registration endpoint (Stage 2), signs in with a real keypair to get
 * a genuine session, then drives the alert endpoints with real HTTP
 * requests.
 *
 * Run with: npx tsx apps/api/tests/alert-routes.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../src/server.js';
import { __resetForTests as resetAlerts } from '../src/alerts/alertStore.js';
import { __resetForTests as resetTokens } from '../src/tokens/tokenStore.js';

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
  const challenge: any = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}&chain=solana`)).json();
  const signature = sign(wallet.privateKey, challenge.message);
  const sessionRes = await fetch(`${base}/api/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challenge.nonce, timestamp: challenge.timestamp, signature }),
  });
  return ((await sessionRes.json()) as any).sessionToken;
}

async function run() {
  process.env.AUTH_SECRET = 'a-real-test-secret-for-alert-routes';
  resetAlerts();
  resetTokens();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const BASE = `http://localhost:${port}`;

  try {
    const walletA = makeWallet();
    const walletB = makeWallet();
    const tokenA = await signIn(BASE, walletA);
    const tokenB = await signIn(BASE, walletB);

    // --- Register a REAL token via the real Stage 2 endpoint first ---
    const registerRes = await fetch(`${BASE}/api/v1/tokens/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 'solana', address: 'RealAlertTestMint111', name: 'Alert Test', symbol: 'ALT', decimals: 6, creatorWalletAddress: 'SomeCreator111' }),
    });
    test('setup: real token registration succeeds', registerRes.status === 201, String(registerRes.status));

    // --- No session at all ---
    const noAuthRes = await fetch(`${BASE}/api/v1/alerts`);
    test('GET with no Authorization header is rejected with 401', noAuthRes.status === 401, String(noAuthRes.status));

    // --- Creating an alert for an UNREGISTERED token is rejected ---
    const badRes = await fetch(`${BASE}/api/v1/alerts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ tokenChain: 'solana', tokenAddress: 'NeverRegisteredMint999', kind: 'price_move', threshold: { percent: 10 } }),
    });
    test('POST for an unregistered token is rejected with 400, not fabricated', badRes.status === 400, String(badRes.status));

    // --- Real, valid alert creation ---
    const createRes = await fetch(`${BASE}/api/v1/alerts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ tokenChain: 'solana', tokenAddress: 'RealAlertTestMint111', kind: 'price_move', threshold: { percent: 10 } }),
    });
    const createBody: any = await createRes.json();
    test('POST for a real, registered token succeeds, 201', createRes.status === 201 && createBody.alert?.kind === 'price_move');

    // --- Invalid kind rejected ---
    const badKindRes = await fetch(`${BASE}/api/v1/alerts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ tokenChain: 'solana', tokenAddress: 'RealAlertTestMint111', kind: 'not_a_real_kind', threshold: {} }),
    });
    test('POST with an invalid kind is rejected with 400', badKindRes.status === 400, String(badKindRes.status));

    // --- List scoped to the authenticated wallet ---
    const listARes = await fetch(`${BASE}/api/v1/alerts`, { headers: { authorization: `Bearer ${tokenA}` } });
    const listABody: any = await listARes.json();
    test('GET returns wallet A\'s own alert', listARes.status === 200 && listABody.alerts.length === 1);

    const listBRes = await fetch(`${BASE}/api/v1/alerts`, { headers: { authorization: `Bearer ${tokenB}` } });
    const listBBody: any = await listBRes.json();
    test('GET for a different wallet\'s session sees NONE of wallet A\'s alerts', listBBody.alerts.length === 0);

    // --- Wallet B cannot delete wallet A's alert ---
    const alertId = createBody.alert.id;
    const crossDeleteRes = await fetch(`${BASE}/api/v1/alerts/${alertId}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokenB}` } });
    test('DELETE by a different wallet is rejected with 403', crossDeleteRes.status === 403, String(crossDeleteRes.status));

    const stillThereRes = await fetch(`${BASE}/api/v1/alerts`, { headers: { authorization: `Bearer ${tokenA}` } });
    const stillThereBody: any = await stillThereRes.json();
    test('the alert still exists after the rejected cross-wallet delete attempt', stillThereBody.alerts.length === 1);

    // --- Real owner can delete ---
    const realDeleteRes = await fetch(`${BASE}/api/v1/alerts/${alertId}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokenA}` } });
    test('DELETE by the real owner succeeds', realDeleteRes.status === 200);

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
