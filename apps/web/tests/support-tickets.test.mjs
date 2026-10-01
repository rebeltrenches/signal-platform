import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../../../functions/api/support/tickets.js';
import { readFileSync } from 'node:fs';

const env = { SIGNAL_SUPPORT_BOT_TOKEN: 'test-only-token', SIGNAL_SUPPORT_CHAT_ID: '-1001234567', SUPPORT_RATE_LIMITER: { async limit() { return { success: true }; } } };
const valid = { category: 'website', contact: '@signaltester', subject: 'Mobile page issue', description: 'The page stops loading when I open a token.', consent: true, company: '', page: 'https://signal.example/explore?secret=do-not-send#session' };
function request(body = valid, headers = {}) {
  return new Request('https://signal.example/api/support/tickets', { method: 'POST', headers: { origin: 'https://signal.example', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
let calls = [];
const originalFetch = globalThis.fetch;
let chat = { id: -1001234567, type: 'channel' };
let delivery = { message_id: 42, chat: { id: -1001234567 } };
globalThis.fetch = async (url, options) => {
  assert.match(url, /^https:\/\/api\.telegram\.org\/bot/);
  calls.push({ method: url.endsWith('getChat') ? 'getChat' : 'sendMessage', body: JSON.parse(options.body) });
  return Response.json({ ok: true, result: url.endsWith('getChat') ? chat : delivery });
};
let count = 0;
async function check(name, fn) { calls = []; await fn(); console.log('ok', name); count++; }
try {
  await check('availability exposes no token or destination; missing config disabled', async () => {
    assert.deepEqual(await onRequestGet({ env }).json(), { configured: true, readiness: { botToken: true, destination: true, rateLimiter: true } });
    assert.deepEqual(await onRequestGet({ env: {} }).json(), { configured: false, readiness: { botToken: false, destination: false, rateLimiter: false } });
    assert.equal((await onRequestPost({ request: request(), env: {} })).status, 503);
    assert.equal(calls.length, 0);
  });
  await check('cross-site requests rejected before delivery', async () => {
    assert.equal((await onRequestPost({ request: request(valid, { origin: 'https://other.example' }), env })).status, 403);
    assert.equal(calls.length, 0);
  });
  await check('rate limiting blocks delivery and fails closed', async () => {
    assert.equal((await onRequestPost({ request: request(), env: { ...env, SUPPORT_RATE_LIMITER: { async limit() { return { success: false }; } } } })).status, 429);
    assert.equal((await onRequestPost({ request: request(), env: { ...env, SUPPORT_RATE_LIMITER: { async limit() { throw Error('failure'); } } } })).status, 503);
    assert.equal(calls.length, 0);
  });
  await check('invalid contact, missing consent, honeypot and bad category rejected', async () => {
    for (const patch of [{ contact: 'invalid' }, { consent: false }, { company: 'spam' }, { category: 'unknown' }, { description: 'short' }, { subject: 'bad\nsubject' }, { page: 'javascript:alert(1)' }]) {
      assert.equal((await onRequestPost({ request: request({ ...valid, ...patch }), env })).status, 400);
    }
    assert.equal(calls.length, 0);
  });
  await check('oversized streamed body and malformed JSON fail', async () => {
    assert.equal((await onRequestPost({ request: request('a'.repeat(12001)), env })).status, 413);
    assert.equal((await onRequestPost({ request: request('{'), env })).status, 400);
    assert.equal(calls.length, 0);
  });
  await check('private destination required and public aliases rejected', async () => {
    for (const patch of [{ username: 'publicchannel' }, { active_usernames: ['publicchannel'] }, { type: 'private' }, { id: -999 }]) {
      chat = { id: -1001234567, type: 'channel', ...patch };
      assert.equal((await onRequestPost({ request: request(), env })).status, 503);
      assert.equal(calls.at(-1).method, 'getChat');
    }
    assert.ok(calls.every(c => c.method === 'getChat'));
    chat = { id: -1001234567, type: 'channel' };
  });
  await check('real receipt required; reference included; no query/session disclosure', async () => {
    const response = await onRequestPost({ request: request(), env });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.delivered, true);
    assert.match(body.reference, /^SIG-[A-F0-9]{16}$/);
    assert.equal(calls.length, 2);
    const sent = calls[1].body;
    assert.ok(sent.text.includes(body.reference));
    assert.ok(sent.text.includes('@signaltester'));
    assert.ok(!sent.text.includes('do-not-send'));
    assert.ok(!sent.text.includes('#session'));
    assert.equal(sent.parse_mode, undefined);
    assert.equal(sent.protect_content, true);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  });
  await check('delivery errors and bad receipt never claim success or expose secrets', async () => {
    delivery = {};
    let response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).delivered, undefined);
    globalThis.fetch = async () => { throw Error('test-only-token'); };
    response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 503);
    const failure = await response.json();
    assert.equal(failure.code, 'BOT_CONNECTION_UNAVAILABLE');
    assert.ok(!JSON.stringify(failure).includes('test-only-token'));
  });
  await check('bot authentication and inbox access failures stop before sending', async () => {
    for (const [status, code] of [[401, 'BOT_AUTH_FAILED'], [404, 'BOT_AUTH_FAILED'], [400, 'BOT_DESTINATION_UNAVAILABLE'], [403, 'BOT_DESTINATION_UNAVAILABLE']]) {
      let attempts = 0;
      globalThis.fetch = async url => {
        attempts++;
        assert.ok(url.endsWith('getChat'));
        return Response.json({ ok: false, error_code: status, description: 'test-only-token' }, { status });
      };
      const response = await onRequestPost({ request: request(), env });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, code);
      assert.ok(!JSON.stringify(body).includes('test-only-token'));
      assert.equal(attempts, 1);
    }
  });
  await check('send timeout remains unconfirmed to prevent duplicate retries', async () => {
    globalThis.fetch = async url => {
      if (url.endsWith('getChat')) return Response.json({ ok: true, result: chat });
      throw Error('timeout');
    };
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'DELIVERY_UNCONFIRMED');
  });
  await check('new route loads support assets; all non-home pages unchanged', async () => {
    const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
    const support = readFileSync(new URL('../dist/support/index.html', import.meta.url), 'utf8');
    assert.ok(home.includes('aria-label="Signal Support"'));
    assert.ok(support.includes('support.js?v=1'));
    assert.ok(support.includes('name="consent"'));
    for (const page of ['create', 'explore', 'token/example', 'wallet/example', 'dashboard', 'security', 'transparency', 'community', 'terms']) {
      const result = readFileSync(new URL(`../dist/${page}/index.html`, import.meta.url), 'utf8');
      assert.ok(!result.includes('support.js'));
      assert.ok(!result.includes('aria-label="Signal Support"'));
    }
  });
} finally { globalThis.fetch = originalFetch; }
console.log(`${count} support ticket checks passed`);
