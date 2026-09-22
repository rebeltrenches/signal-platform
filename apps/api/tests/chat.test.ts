/**
 * Real, end-to-end tests for the chat backend: starts the actual
 * apps/api HTTP server (the same createServer() a real deployment
 * would use) on a real local port, and drives it with real HTTP
 * requests and real Ed25519 signatures — not calling the handler
 * functions directly with hand-built request objects. This is the same
 * "spin up the real thing and hit it" approach already used to verify
 * the tax route earlier in this project, extended to cover chat.
 *
 * Run with: npx tsx apps/api/tests/chat.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../src/server.js';
import { __resetForTests } from '../src/chat/store.js';

const PORT = 4123;
const BASE = `http://localhost:${PORT}`;

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

// --- Real Ed25519 keypair + base58 helpers, independent of the app's own
// verify.ts, so these tests prove the WIRE PROTOCOL works, not just that
// the server's internals agree with themselves. ---
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

/** Builds a real, correctly-signed write request body — mirrors exactly
 *  what apps/web/src/client/chat.js does client-side. */
function signedBody(wallet: ReturnType<typeof makeWallet>, roomId: string, action: string, payload: string, timestamp = Date.now()) {
  const canonical = `signal-chat|${roomId}|${action}|${payload}|${timestamp}`;
  return { walletAddress: wallet.address, signature: sign(wallet.privateKey, canonical), timestamp };
}

async function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** DELETE requests carry their signed fields as query params, not a
 *  body — see routes/chat.ts's deleteChatMessage for exactly why. */
async function deleteReq(path: string, fields: { walletAddress: string; signature: string; timestamp: number }) {
  const qs = new URLSearchParams({ walletAddress: fields.walletAddress, signature: fields.signature, timestamp: String(fields.timestamp) });
  const res = await fetch(`${BASE}${path}?${qs}`, { method: 'DELETE' });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  __resetForTests();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log('chat.test.ts\n');

  try {
    const alice = makeWallet();
    const bob = makeWallet();

    // ---- Persistence + main room ----
    {
      const empty = await req('GET', '/api/v1/chat/main/messages');
      test('main room starts empty (honest, not fabricated)', empty.status === 200 && empty.json.messages.length === 0);

      const body = signedBody(alice, 'main', 'post', 'hello signal');
      const posted = await req('POST', '/api/v1/chat/main/messages', { ...body, content: 'hello signal' });
      test('a correctly-signed post succeeds (201)', posted.status === 201, JSON.stringify(posted.json));
      test('the response echoes the posted content', posted.json?.message?.content === 'hello signal');
      test('the response includes a real timestamp', typeof posted.json?.message?.createdAt === 'string');

      const after = await req('GET', '/api/v1/chat/main/messages');
      test('the message is really persisted — a second fetch sees it', after.json.messages.length === 1 && after.json.messages[0].content === 'hello signal');
    }

    // ---- Signature verification (the real anti-impersonation mechanism) ----
    {
      const canonical = `signal-chat|main|post|impersonating alice|${Date.now()}`;
      const forgedSignature = sign(bob.privateKey, canonical); // Bob signs it...
      const forged = await req('POST', '/api/v1/chat/main/messages', {
        walletAddress: alice.address, // ...but claims to be Alice
        signature: forgedSignature,
        timestamp: Date.now(),
        content: 'impersonating alice',
      });
      test('a message signed by the WRONG wallet is rejected (impersonation blocked)', forged.status === 400 && /signature/i.test(forged.json?.message ?? ''));

      const tampered = signedBody(alice, 'main', 'post', 'original content');
      const withDifferentContent = await req('POST', '/api/v1/chat/main/messages', { ...tampered, content: 'TAMPERED content' });
      test('content that differs from what was actually signed is rejected', withDifferentContent.status === 400);

      const expired = signedBody(alice, 'main', 'post', 'old message', Date.now() - 120_000);
      const expiredRes = await req('POST', '/api/v1/chat/main/messages', { ...expired, content: 'old message' });
      test('an expired (>60s old) signature is rejected — bounds replay', expiredRes.status === 400 && /expired/i.test(expiredRes.json?.message ?? ''));
    }

    // ---- Validation ----
    {
      const empty = signedBody(alice, 'main', 'post', '');
      const emptyRes = await req('POST', '/api/v1/chat/main/messages', { ...empty, content: '' });
      test('empty message content is rejected', emptyRes.status === 400);

      const tooLong = 'x'.repeat(501);
      const tooLongBody = signedBody(alice, 'main', 'post', tooLong);
      const tooLongRes = await req('POST', '/api/v1/chat/main/messages', { ...tooLongBody, content: tooLong });
      test('over-length (>500 char) message is rejected', tooLongRes.status === 400 && /500/.test(tooLongRes.json?.message ?? ''));

      const xssContent = '<script>alert(1)</script>';
      const xssBody = signedBody(bob, 'main', 'post', xssContent, Date.now() + 5000);
      const xssRes = await req('POST', '/api/v1/chat/main/messages', { ...xssBody, content: xssContent });
      test('HTML in message content is escaped before storage (XSS prevention)', xssRes.status === 201 && !xssRes.json.message.content.includes('<script>') && xssRes.json.message.content.includes('&lt;script&gt;'));
    }

    // ---- Rate limiting ----
    {
      const carol = makeWallet();
      const first = signedBody(carol, 'main', 'post', 'first message', Date.now() + 10000);
      const firstRes = await req('POST', '/api/v1/chat/main/messages', { ...first, content: 'first message' });
      test('rate-limit setup: first message from a fresh wallet succeeds', firstRes.status === 201);

      const second = signedBody(carol, 'main', 'post', 'second message immediately', Date.now() + 10000);
      const secondRes = await req('POST', '/api/v1/chat/main/messages', { ...second, content: 'second message immediately' });
      test('a second message within the rate-limit window is rejected (429)', secondRes.status === 429, JSON.stringify(secondRes.json));
    }

    // ---- Token room association ----
    {
      const dave = makeWallet(); // fresh wallet — avoids the rate-limit window from alice's earlier posts above
      const mintA = 'MintAAAA1111111111111111111111111111111';
      const mintB = 'MintBBBB2222222222222222222222222222222';

      const postToA = signedBody(dave, `token:${mintA}`, 'post', 'gm token A holders');
      const resA = await req('POST', `/api/v1/chat/token/${mintA}/messages`, { ...postToA, content: 'gm token A holders' });
      test('posting to a token room succeeds and creates the room', resA.status === 201, JSON.stringify(resA.json));

      const listA = await req('GET', `/api/v1/chat/token/${mintA}/messages`);
      const listB = await req('GET', `/api/v1/chat/token/${mintB}/messages`);
      test('token A room shows the message posted to it', listA.json.messages.length === 1);
      test('token B room is a genuinely separate, empty room (no cross-contamination)', listB.json.messages.length === 0);
      test("the room response clearly identifies which token it belongs to", listA.json.room.tokenAddress === mintA);

      const mainList = await req('GET', '/api/v1/chat/main/messages');
      test('the main room is unaffected by token-room posts (rooms are isolated)', !mainList.json.messages.some((m: any) => m.content === 'gm token A holders'));
    }

    // ---- Moderation: report ----
    {
      const erin = makeWallet(); // fresh poster
      const frank = makeWallet(); // fresh reporter
      const target = signedBody(erin, 'main', 'post', 'a message someone will report');
      const posted = await req('POST', '/api/v1/chat/main/messages', { ...target, content: 'a message someone will report' });
      test('setup: the message to be reported was actually posted', posted.status === 201, JSON.stringify(posted.json));
      const messageId = posted.json.message.id;

      const reportSig = signedBody(frank, 'msg', 'report', messageId);
      const reportRes = await req('POST', `/api/v1/chat/messages/${messageId}/report`, reportSig);
      test('a signed report succeeds', reportRes.status === 200 && reportRes.json.message.reportCount === 1, JSON.stringify(reportRes.json));

      const secondReportSig = signedBody(frank, 'msg', 'report', messageId, Date.now() + 1000);
      const secondReportRes = await req('POST', `/api/v1/chat/messages/${messageId}/report`, secondReportSig);
      test('the same wallet reporting the same message twice does not double-count', secondReportRes.json.message.reportCount === 1);
    }

    // ---- Moderation: delete authorization ----
    {
      const grace = makeWallet(); // fresh poster
      const henry = makeWallet(); // fresh, non-moderator wallet attempting deletion
      const target = signedBody(grace, 'main', 'post', 'a message someone will try to delete');
      const posted = await req('POST', '/api/v1/chat/main/messages', { ...target, content: 'a message someone will try to delete' });
      test('setup: the message to be deleted was actually posted', posted.status === 201, JSON.stringify(posted.json));
      const messageId = posted.json.message.id;

      const unauthorizedDelete = signedBody(henry, 'msg', 'delete', messageId);
      const unauthorizedRes = await deleteReq(`/api/v1/chat/messages/${messageId}`, unauthorizedDelete);
      test('a non-moderator cannot delete a message (403)', unauthorizedRes.status === 403, JSON.stringify(unauthorizedRes.json));

      const stillThere = await req('GET', '/api/v1/chat/main/messages');
      test('the message was NOT actually removed by the unauthorized attempt', stillThere.json.messages.some((m: any) => m.id === messageId && m.content === 'a message someone will try to delete'));

      // Grant henry moderator status the same way the real app would — via
      // the env-var allowlist — then retry the exact same action.
      process.env.CHAT_MODERATOR_WALLETS = henry.address;
      const authorizedDelete = signedBody(henry, 'msg', 'delete', messageId, Date.now() + 1000);
      const authorizedRes = await deleteReq(`/api/v1/chat/messages/${messageId}`, authorizedDelete);
      test('an authorized moderator CAN delete a message', authorizedRes.status === 200 && authorizedRes.json.message.deleted === true, JSON.stringify(authorizedRes.json));

      const afterDelete = await req('GET', '/api/v1/chat/main/messages');
      const tombstone = afterDelete.json.messages.find((m: any) => m.id === messageId);
      test('the deleted message appears as a tombstone (soft-delete), original content never returned', tombstone && tombstone.deleted === true && tombstone.content === null);
      delete process.env.CHAT_MODERATOR_WALLETS;
    }

    // ---- Malformed requests never crash the server ----
    {
      const garbage = await req('POST', '/api/v1/chat/main/messages', { walletAddress: 123, signature: null });
      test('a malformed request body is rejected cleanly, not a 500', garbage.status === 400);

      const noBody = await fetch(`${BASE}/api/v1/chat/main/messages`, { method: 'POST' });
      test('a POST with no body at all is rejected cleanly', noBody.status === 400);
    }
  } finally {
    server.close();
  }

  console.log(`\n${passed} test(s) passed.`);
}

main();
