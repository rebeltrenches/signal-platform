const CATEGORIES = new Set(['wallet', 'launch', 'trade', 'data', 'website', 'other']);
const HEADERS = { 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' };
function reply(status, message, code) {
  return Response.json({ message, code }, { status, headers: HEADERS });
}
function botToken(env) {
  return String(env.SIGNAL_SUPPORT_BOT_TOKEN || '').trim();
}
function validBotToken(env) {
  return /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(botToken(env));
}
function configured(env) {
  return Boolean(validBotToken(env) && /^-\d+$/.test(env.SIGNAL_SUPPORT_CHAT_ID || '') && env.SUPPORT_RATE_LIMITER);
}
export function onRequestGet({ env }) {
  return Response.json({ configured: configured(env), readiness: { botToken: validBotToken(env), destination: /^-\d+$/.test(env.SIGNAL_SUPPORT_CHAT_ID || ''), rateLimiter: Boolean(env.SUPPORT_RATE_LIMITER) } }, { headers: HEADERS });
}
async function telegram(env, method, body) {
  // Never log the request URL: Telegram authenticates using a token in its path.
  const response = await fetch(`https://api.telegram.org/bot${botToken(env)}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    const error = new Error('TELEGRAM_UNAVAILABLE');
    error.telegramCode = Number(result.error_code || response.status);
    throw error;
  }
  return result.result;
}
async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_BODY');
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 12000) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function field(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
export async function onRequestPost({ request, env }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply(403, 'Submit tickets from the Signal support page.', 'INVALID_ORIGIN');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415, 'Use the support form to submit your ticket.', 'INVALID_CONTENT_TYPE');
  if (!configured(env)) return reply(503, 'Ticket delivery is not available yet. Please try again later.', 'SUPPORT_UNAVAILABLE');
  try {
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) return reply(503, 'Ticket delivery is temporarily unavailable.', 'SUPPORT_UNAVAILABLE');
    const limit = await env.SUPPORT_RATE_LIMITER.limit({ key: `support:${ip}` });
    if (!limit.success) return reply(429, 'Too many requests. Please wait a minute before trying again.', 'RATE_LIMITED');
  } catch { return reply(503, 'Ticket delivery is temporarily unavailable.', 'SUPPORT_UNAVAILABLE'); }
  let body;
  try { body = await boundedJson(request); }
  catch (error) { return reply(error.message === 'BODY_TOO_LARGE' ? 413 : 400, 'Please check your ticket details.', 'INVALID_BODY'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.company || body.consent !== true ||
      !CATEGORIES.has(body.category) || !field(body.contact, 5, 254) ||
      !field(body.subject, 5, 100) || !field(body.description, 20, 2000) ||
      (body.page && !field(body.page, 0, 300))) return reply(400, 'Complete the contact, issue type, subject, description and consent fields.', 'VALIDATION_ERROR');
  const contact = body.contact.trim();
  if (!(/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(contact) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))) return reply(400, 'Enter an email address or a Telegram username beginning with @.', 'INVALID_CONTACT');
  if (/[\r\n]/.test(body.subject)) return reply(400, 'Keep the subject on one line.', 'VALIDATION_ERROR');
  let page = '';
  if (body.page) {
    try {
      const url = new URL(body.page);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_URL');
      // Query strings and fragments can contain session tokens; only transmit the path.
      page = url.origin + url.pathname;
    } catch { return reply(400, 'Enter a valid page URL.', 'INVALID_PAGE'); }
  }
  if (/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(body.description + body.subject)) return reply(400, 'Remove bot tokens or other secrets before submitting.', 'SECRET_DETECTED');
  const reference = 'SIG-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  let sending = false;
  try {
    const chat = await telegram(env, 'getChat', { chat_id: env.SIGNAL_SUPPORT_CHAT_ID });
    // Do not deliver personal ticket details into a public channel/supergroup.
    if (!['group', 'supergroup', 'channel'].includes(chat.type) || chat.username || chat.active_usernames?.length || String(chat.id) !== env.SIGNAL_SUPPORT_CHAT_ID) {
      return reply(503, 'Ticket delivery is temporarily unavailable.', 'SUPPORT_UNAVAILABLE');
    }
    const text = `${reference}\nNew Signal support ticket\n\nIssue: ${body.category}\nContact: ${contact}\nSubject: ${body.subject.trim()}\n${page ? `Page: ${page}\n` : ''}\n${body.description.trim()}`;
    sending = true;
    const sent = await telegram(env, 'sendMessage', { chat_id: env.SIGNAL_SUPPORT_CHAT_ID, text, link_preview_options: { is_disabled: true }, protect_content: true });
    if (!Number.isInteger(sent.message_id) || String(sent.chat?.id) !== env.SIGNAL_SUPPORT_CHAT_ID) throw new Error('INVALID_RECEIPT');
    return Response.json({ delivered: true, reference }, { status: 201, headers: HEADERS });
  } catch (error) {
    // Log only bounded classifications, never errors, URLs, tokens or ticket text.
    console.error('signal_support_delivery_failure', JSON.stringify({
      stage: sending ? 'send' : 'verify',
      kind: ['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError', 'Error'].includes(error.name) ? error.name : 'Other',
      telegramStatus: Number.isInteger(error.telegramCode) ? error.telegramCode : null,
    }));
    if (!sending) {
      if ([401, 404].includes(error.telegramCode)) return reply(503, 'The support bot connection needs to be corrected. No ticket was sent.', 'BOT_AUTH_FAILED');
      if ([400, 403].includes(error.telegramCode)) return reply(503, 'The support bot cannot access the team inbox. No ticket was sent.', 'BOT_DESTINATION_UNAVAILABLE');
      const reason = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'BOT_CONNECTION_TIMEOUT' : error instanceof SyntaxError ? 'BOT_INVALID_RESPONSE' : 'BOT_CONNECTION_UNAVAILABLE';
      return reply(503, 'Telegram could not be reached to verify the team inbox. No ticket was sent.', reason);
    }
    return reply(502, 'We could not confirm delivery. Check with support before resending to avoid a duplicate.', 'DELIVERY_UNCONFIRMED');
  }
}
