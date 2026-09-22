/**
 * A deliberately tiny, dependency-free router. This sandbox has no
 * internet, so a real framework (Fastify/Express) can't be npm-installed
 * here — using only Node's built-in `http` module means this skeleton
 * genuinely runs and can be genuinely tested today, with zero risk of
 * "works once you have the framework installed" being an unverified
 * claim. Swapping this for Fastify later is a small, mechanical change
 * (route handlers below are already plain (req) => response functions —
 * that shape maps directly onto Fastify handlers) — not a redesign.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteRequest {
  method: string;
  pathname: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Real incoming request headers, lowercased keys (Node's own
   *  convention) — added for Stage 19 auth (routes/auth.ts needs to
   *  read a real Authorization header, which nothing before this
   *  needed). Every existing handler that doesn't use this is
   *  unaffected; nothing was removed. */
  headers: Record<string, string | string[] | undefined>;
}

export interface RouteResponse {
  status: number;
  body: unknown;
}

export type Handler = (req: RouteRequest) => Promise<RouteResponse> | RouteResponse;

interface Route {
  method: string;
  pattern: string[]; // e.g. ['api', 'v1', 'tokens', ':chain', ':address']
  handler: Handler;
}

export interface RouterSecurityOptions {
  maxBodyBytes?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cache-control': 'no-store',
} as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * CORS: allowed origins come from CORS_ORIGINS (comma-separated exact
 * origins, e.g. "https://signal-platform.launchsignal.workers.dev").
 * When unset, localhost/127.0.0.1 on any port is allowed by default —
 * so local development keeps working with zero configuration — but no
 * production origin is ever implicitly trusted; a real deployment must
 * set CORS_ORIGINS explicitly. The allowed origin is always reflected
 * back exactly (never "*"), because credentialed requests (this API
 * reads no cookies, but a future one might) can't use a wildcard
 * origin per the CORS spec, and exact-origin reflection is the correct
 * pattern regardless of whether credentials are in play today.
 */
function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function resolveAllowedOrigin(requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null;
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.includes(requestOrigin)) return requestOrigin;
  if (configured.length === 0 && isLocalOrigin(requestOrigin)) return requestOrigin;
  return null;
}

function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  const allowed = resolveAllowedOrigin(requestOrigin);
  if (!allowed) return {};
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '600', // cache the preflight result for 10 minutes — real browsers respect this and skip repeat OPTIONS round-trips for the same origin/method/headers combination within that window
    vary: 'origin',
  };
}

export class Router {
  private routes: Route[] = [];
  private readonly maxBodyBytes: number;
  private readonly rateLimitMax: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(options: RouterSecurityOptions = {}) {
    this.maxBodyBytes = options.maxBodyBytes ?? positiveInteger(process.env.API_MAX_BODY_BYTES, 1_048_576);
    this.rateLimitMax = options.rateLimitMax ?? positiveInteger(process.env.API_RATE_LIMIT_MAX, 300);
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? positiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
  }

  register(method: string, path: string, handler: Handler): void {
    this.routes.push({ method: method.toUpperCase(), pattern: path.split('/').filter(Boolean), handler });
  }

  private match(method: string, pathParts: string[]): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.length !== pathParts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.pattern.length; i++) {
        const seg = route.pattern[i]!;
        const actual = pathParts[i]!;
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(actual);
        } else if (seg !== actual) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handleNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathParts = url.pathname.split('/').filter(Boolean);
    const origin = req.headers.origin;
    const cors = corsHeaders(origin);
    const responseHeaders = { 'content-type': 'application/json', ...SECURITY_HEADERS, ...cors };

    // A real preflight response — every error path below also carries
    // `cors`, so a rejected/errored request is still readable by the
    // browser's fetch(), not silently opaque the way a CORS-header-only-
    // on-success implementation would leave it.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...SECURITY_HEADERS, ...cors });
      res.end();
      return;
    }

    const matched = this.match(req.method ?? 'GET', pathParts);

    const forwarded = req.headers['x-forwarded-for'];
    const clientKey = process.env.TRUST_PROXY === 'true' && typeof forwarded === 'string'
      ? forwarded.split(',')[0]!.trim()
      : req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (this.rateLimits.size > 10_000) {
      for (const [key, value] of this.rateLimits) {
        if (value.resetAt <= now) this.rateLimits.delete(key);
      }
    }
    const current = this.rateLimits.get(clientKey);
    const bucket = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + this.rateLimitWindowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
    this.rateLimits.set(clientKey, bucket);
    if (bucket.count > this.rateLimitMax) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.writeHead(429, { ...responseHeaders, 'retry-after': String(retryAfter) });
      res.end(JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' }));
      return;
    }

    let body: unknown = undefined;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const declaredLength = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > this.maxBodyBytes) {
        res.writeHead(413, responseHeaders);
        res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds the ${this.maxBodyBytes}-byte limit.` }));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        const buffer = chunk as Buffer;
        received += buffer.length;
        if (received > this.maxBodyBytes) {
          res.writeHead(413, responseHeaders);
          res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds the ${this.maxBodyBytes}-byte limit.` }));
          return;
        }
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, responseHeaders);
          res.end(JSON.stringify({ error: 'INVALID_JSON', message: 'Request body was not valid JSON.' }));
          return;
        }
      }
    }

    if (!matched) {
      res.writeHead(404, responseHeaders);
      res.end(JSON.stringify({ error: 'NOT_FOUND', path: url.pathname }));
      return;
    }

    const routeReq: RouteRequest = {
      method: req.method ?? 'GET',
      pathname: url.pathname,
      params: matched.params,
      query: url.searchParams,
      body,
      headers: req.headers,
    };

    try {
      const result = await matched.route.handler(routeReq);
      res.writeHead(result.status, responseHeaders);
      res.end(JSON.stringify(result.body, jsonReplacer, 2));
    } catch (err) {
      res.writeHead(500, responseHeaders);
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'An internal error occurred.' }));
    }
  }
}

// bigint doesn't survive JSON.stringify by default — every tax/amount
// value in this API is a bigint per the "never use float for money" rule,
// so the router itself handles the serialization instead of leaving it to
// every individual route.
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Stubs an endpoint that's real in the spec but not implemented yet.
 *  Returns 501, never fake data — spec section 41. */
export function notImplemented(stage: string, note?: string): Handler {
  return () => ({
    status: 501,
    body: {
      error: 'NOT_IMPLEMENTED',
      message: `This endpoint is planned but not built yet (${stage}). See docs/ROADMAP.md.`,
      note: note ?? null,
    },
  });
}
