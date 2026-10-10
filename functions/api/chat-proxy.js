// Keep chat API calls same-origin, forwarding only the required headers.
// Uses the existing API origin; never accepts an upstream URL from a visitor.
export async function chatApiProxy({ request, env }) {
  const url = new URL(request.url);
  const headers = { 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' };
  const room = /^\/api\/v1\/chat\/(main|token\/[1-9A-HJ-NP-Za-km-z]{32,44})\/messages$/.test(url.pathname);
  const report = /^\/api\/v1\/chat\/messages\/[a-zA-Z0-9_-]{1,128}\/report$/.test(url.pathname);
  const message = /^\/api\/v1\/chat\/messages\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname);
  const moderator = url.pathname === '/api/v1/chat/is-moderator';
  if (!room && !report && !message && !moderator) return Response.json({ message: 'Route not found.' }, { status: 404, headers });
  const allowed = room ? ['GET', 'POST'] : report ? ['POST'] : message ? ['DELETE'] : ['GET'];
  const bodyLimit = 5_000;
  if (!allowed.includes(request.method)) return Response.json({ message: 'Method not allowed.' }, { status: 405, headers });
  const origin = env.SIGNAL_API_ORIGIN || env.SIGNAL_API_BASE_URL;
  if (!origin) return Response.json({ message: 'Chat is not available on this deployment yet.' }, { status: 503, headers });
  let upstream;
  try { upstream = new URL(origin); } catch { return Response.json({ message: 'Chat is temporarily unavailable.' }, { status: 503, headers }); }
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password) return Response.json({ message: 'Chat is temporarily unavailable.' }, { status: 503, headers });
  const forwarded = new Headers({ accept: 'application/json' });
  if (request.headers.get('authorization')) forwarded.set('authorization', request.headers.get('authorization'));
  const ip = request.headers.get('cf-connecting-ip');
  if (ip && /^[0-9a-fA-F:.]{3,64}$/.test(ip)) forwarded.set('x-forwarded-for', ip);
  let body;
  if (request.method === 'PUT' || request.method === 'POST') {
    if (Number(request.headers.get('content-length')) > bodyLimit) return Response.json({ message: 'Request body is too large.' }, { status: 413, headers });
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) return Response.json({ message: 'Send chat details as JSON.' }, { status: 415, headers });
    // Bound streamed bodies too; content-length may be absent or untrusted.
    const reader = request.body?.getReader(); const chunks = []; let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > bodyLimit) { await reader.cancel(); return Response.json({ message: 'Request body is too large.' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } body = bytes;
    forwarded.set('content-type', 'application/json');
  }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(new URL(url.pathname + url.search, upstream.origin), { method: request.method, headers: forwarded, ...(body ? { body } : {}), redirect: 'error', signal: controller.signal });
    if (!(response.headers.get('content-type') || '').includes('application/json') || response.status >= 500) return Response.json({ message: 'Chat is temporarily unavailable. Please try again.' }, { status: 503, headers });
    if (response.status === 404) {
      const payload = await response.json();
      // Old API routers identify an unimplemented route by its path.
      if (payload.path) return Response.json({ message: 'Chat is not available on this deployment yet.' }, { status: 503, headers });
      return Response.json(payload, { status: 404, headers });
    }
    return new Response(await response.arrayBuffer(), { status: response.status, headers: { ...headers, 'content-type': 'application/json' } });
  } catch { return Response.json({ message: 'Chat is temporarily unavailable. Please try again.' }, { status: 503, headers }); }
  finally { clearTimeout(timeout); }
}
