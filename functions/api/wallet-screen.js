// POST /api/wallet-screen { address } — sanctions screening of a Solana (or
// Base/BNB) wallet against the OFAC SDN list (compliance.js), used by the site right after a
// wallet connects. The Worker screens again itself before registering a
// launch or building a trade, so this answer is never the only check.
// Rate-limited per IP. The list is held in memory (compliance.js); a failed
// read is reused for at most 30 seconds.
import { screenWallet, isScreenableAddress, geoForRequest, jsonResponse, SCREENING_VERSION, screeningStatus } from "../compliance.js";

export const SCREEN_RATE_LIMIT = { requests: 30, windowMs: 60_000 };
const windows = new Map(); // ip -> [timestamps]

function allow(ip, now) {
  const recent = (windows.get(ip) || []).filter((t) => t > now - SCREEN_RATE_LIMIT.windowMs);
  if (recent.length >= SCREEN_RATE_LIMIT.requests) {
    windows.set(ip, recent);
    return false;
  }
  recent.push(now);
  windows.set(ip, recent);
  if (windows.size > 10_000) windows.delete(windows.keys().next().value);
  return true;
}

export function resetWalletScreenForTests() {
  windows.clear();
}

export async function onRequestPost({ request, env, now = Date.now() }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { code: "INVALID_JSON", error: "Invalid JSON body." });
  }
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!isScreenableAddress(address)) return jsonResponse(400, { code: "INVALID_ADDRESS", error: "Not a valid wallet address." });
  if (geoForRequest(request).level === "blocked") {
    return jsonResponse(451, { code: "REGION_BLOCKED", error: "Signal isn't available in your region." });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!allow(ip, now)) {
    return jsonResponse(429, { code: "RATE_LIMITED", error: "Too many wallet checks; try again in a minute." }, { "retry-after": "60" });
  }
  const result = await screenWallet(address, env, now);
  const version = { "x-signal-screening": SCREENING_VERSION };
  if (result.status === "sanctioned") {
    return jsonResponse(200, { status: "sanctioned", message: "This wallet appears on a sanctions list. It can't launch or trade on Signal." }, version);
  }
  if (result.status === "unavailable") {
    return jsonResponse(200, { status: "unavailable", message: `${result.reason} Launching and trading are paused until the check succeeds; please try again in a minute.` }, version);
  }
  return jsonResponse(200, { status: "clear" }, version);
}

/** GET /api/screening-status: the screening code version, the Cloudflare
 *  data centre answering, and whether the OFAC list is loaded there (or the
 *  reason it isn't). No wallet data; for diagnosing "list couldn't be
 *  loaded" from a visitor's own browser. */
export async function onRequestGet({ request, env, now = Date.now() }) {
  const status = await screeningStatus(env, now);
  return jsonResponse(200, { ...status, colo: request.cf?.colo || null }, { "x-signal-screening": SCREENING_VERSION });
}
