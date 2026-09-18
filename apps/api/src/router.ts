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

export class Router {
  private routes: Route[] = [];

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
    const matched = this.match(req.method ?? 'GET', pathParts);

    let body: unknown = undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'INVALID_JSON', message: 'Request body was not valid JSON.' }));
          return;
        }
      }
    }

    if (!matched) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND', path: url.pathname }));
      return;
    }

    const routeReq: RouteRequest = {
      method: req.method ?? 'GET',
      pathname: url.pathname,
      params: matched.params,
      query: url.searchParams,
      body,
    };

    try {
      const result = await matched.route.handler(routeReq);
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body, jsonReplacer, 2));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: (err as Error).message }));
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
