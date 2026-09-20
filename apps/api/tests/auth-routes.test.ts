/**
 * Real, end-to-end tests for the auth routes: starts the actual
 * apps/api HTTP server and drives it with real HTTP requests and a
 * real Ed25519 signature — same "spin up the real thing" approach as
 * chat.test.ts and token-routes.test.ts.
 *
 * Run with: npx tsx apps/api/tests/auth-routes.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../src/server.js';

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

async function run() {
  process.env.AUTH_SECRET = 'a-real-test-secret-for-this-http-test-run';
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const BASE = `http://localhost:${port}`;

  try {
    const wallet = makeWallet();

    const challengeRes = await fetch(`${BASE}/api/v1/auth/challenge?address=${wallet.address}&chain=solana`);
    const challengeBody = await challengeRes.json();
    test('requesting a challenge returns 200 with a real message to sign', challengeRes.status === 200 && typeof challengeBody.message === 'string');

    const signature = sign(wallet.privateKey, challengeBody.message);
    const sessionRes = await fetch(`${BASE}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challengeBody.nonce, timestamp: challengeBody.timestamp, signature }),
    });
    const sessionBody = await sessionRes.json();
    test('a real, correctly-signed challenge exchanges for a real session token', sessionRes.status === 200 && typeof sessionBody.sessionToken === 'string');

    const meRes = await fetch(`${BASE}/api/v1/auth/session`, {
      headers: { authorization: `Bearer ${sessionBody.sessionToken}` },
    });
    const meBody = await meRes.json();
    test('the real session token authenticates a subsequent request via the standard Authorization header', meRes.status === 200 && meBody.address === wallet.address);

    const replayRes = await fetch(`${BASE}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challengeBody.nonce, timestamp: challengeBody.timestamp, signature }),
    });
    test('the same nonce cannot be replayed to mint a second session', replayRes.status === 400, String(replayRes.status));

    const noAuthRes = await fetch(`${BASE}/api/v1/auth/session`);
    test('no Authorization header at all is honestly rejected as unauthorized', noAuthRes.status === 401, String(noAuthRes.status));

    const forger = makeWallet();
    const challenge2 = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${wallet.address}&chain=solana`)).json();
    const forgedSig = sign(forger.privateKey, challenge2.message);
    const forgedRes = await fetch(`${BASE}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challenge2.nonce, timestamp: challenge2.timestamp, signature: forgedSig }),
    });
    test('a forged signature over real HTTP is rejected with 401', forgedRes.status === 401, String(forgedRes.status));

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
