// POST /api/v1/tokens/register on the Worker — the only way a launch gets
// listed on Signal. The Signal API (on Render) can't see a visitor's
// country, so the Worker checks first and then forwards:
//   1. Level 1 (blocked) locations are refused (451).
//   2. The signed-in wallet is read from the API's own session endpoint
//      (never from the request body) and screened for sanctions;
//      sanctioned wallets are refused (403), and a failed screening check
//      fails safe (503, "try again").
//   3. The request is forwarded with the shared secret SIGNAL_EDGE_SECRET,
//      the screened wallet and the country. The API accepts registrations
//      only with that secret, so nothing can go around this route.
// Needs SIGNAL_API_ORIGIN (a wrangler var) and the Worker secrets
// SIGNAL_EDGE_SECRET and CHAINALYSIS_API_KEY; without them it fails safe.
import { refusalFor, geoForRequest, jsonResponse } from "../compliance.js";

const MAX_BODY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

function apiOrigin(env) {
  const origin = typeof env?.SIGNAL_API_ORIGIN === "string" ? env.SIGNAL_API_ORIGIN.trim().replace(/\/$/, "") : "";
  return origin.startsWith("https://") ? origin : null;
}

export async function onRequestPost({ request, env }) {
  const origin = apiOrigin(env);
  const edgeSecret = typeof env?.SIGNAL_EDGE_SECRET === "string" ? env.SIGNAL_EDGE_SECRET : "";
  if (!origin || !edgeSecret) {
    return jsonResponse(503, { code: "REGISTRATION_NOT_CONFIGURED", error: "Listing on Signal isn't available right now; please try again later." });
  }

  // Location first: blocked regions never reach the API.
  const regionRefusal = await refusalFor(request, env, undefined, "launch");
  if (regionRefusal) return regionRefusal;

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse(401, { code: "UNAUTHORIZED", error: "Sign in with the creator wallet to register a token." });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return jsonResponse(413, { code: "BODY_TOO_LARGE", error: "Request body too large." });

  // The session's own wallet, as the API sees it.
  let wallet;
  try {
    const session = await fetch(`${origin}/api/v1/auth/session`, {
      headers: { authorization },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (session.status === 401) return jsonResponse(401, { code: "UNAUTHORIZED", error: "Your sign-in expired; sign in again." });
    if (!session.ok) throw new Error(`session ${session.status}`);
    wallet = (await session.json())?.address;
  } catch {
    return jsonResponse(503, { code: "API_UNAVAILABLE", error: "Signal's API is unreachable; please try again in a minute." });
  }

  const walletRefusal = await refusalFor(request, env, wallet, "launch");
  if (walletRefusal) return walletRefusal;

  const geo = geoForRequest(request);
  try {
    const upstream = await fetch(`${origin}/api/v1/tokens/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
        "x-signal-edge-secret": edgeSecret,
        "x-signal-screened-wallet": wallet,
        "x-signal-country": geo.country || "",
      },
      body: text,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store, max-age=0" },
    });
  } catch {
    return jsonResponse(503, { code: "API_UNAVAILABLE", error: "Signal's API is unreachable; please try again in a minute." });
  }
}
