// Regional restrictions and wallet sanctions screening, shared by the
// Worker routes. Levels come only from config/restrictions.json (see its
// comments); nothing here lists countries.
//
//   Level 1 "blocked":   no connect, launch or trade (browsing allowed)
//   Level 2 "regulated": allowed after an extra region-specific warning
//   Level 3:             wallets screened with Chainalysis's sanctions API
//
// Location is Cloudflare's: request.cf.country (same as the CF-IPCountry
// header) and request.cf.regionCode for sanctioned sub-national regions.
// Screening needs the Worker secret CHAINALYSIS_API_KEY. Any screening
// failure is reported as "unavailable" so callers fail safe.
import restrictions from "../config/restrictions.json" with { type: "json" };

export const RESTRICTIONS = restrictions;
export const SCREENING_CACHE_MS = { clear: 10 * 60_000, sanctioned: 10 * 60_000 };
const SCREENING_TIMEOUT_MS = 6_000;
const CHAINALYSIS_URL = "https://public.chainalysis.com/api/v1/address/";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_CACHE_ENTRIES = 5_000;

/** Visitor location from Cloudflare. Unknown locations (none, XX, Tor's T1)
 *  come back as country null. */
export function locationFromRequest(request) {
  const cf = request.cf || {};
  const raw = String(cf.country || request.headers.get("cf-ipcountry") || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;
  const region = typeof cf.regionCode === "string" && cf.regionCode ? cf.regionCode.toUpperCase() : null;
  return { country, region };
}

/** The level for a location, from the config only. */
export function levelFor({ country, region }, config = RESTRICTIONS) {
  const blocked = config.levels.blocked;
  const regionKey = country && region ? `${country}-${region}` : null;
  if (regionKey && regionKey in blocked.regions && regionKey !== "$comment") {
    return { level: "blocked", name: blocked.regions[regionKey].name, notice: blocked.notice };
  }
  if (country && Object.hasOwn(blocked.countries, country)) {
    return { level: "blocked", name: blocked.countries[country].name, notice: blocked.notice };
  }
  const regulated = config.levels.regulated.countries;
  if (country && Object.hasOwn(regulated, country)) {
    return { level: "regulated", name: regulated[country].name, warning: regulated[country].warning };
  }
  return { level: "allowed" };
}

export function geoForRequest(request, config = RESTRICTIONS) {
  const location = locationFromRequest(request);
  return { ...location, ...levelFor(location, config), termsVersion: config.termsVersion };
}

// ---------------------------------------------------------------------------
// Chainalysis sanctions screening

const screeningCache = new Map(); // address -> { result, expires }
const screeningInFlight = new Map(); // address -> Promise

export function isSolanaAddress(value) {
  return typeof value === "string" && SOLANA_ADDRESS.test(value);
}

/** { status: "clear" } | { status: "sanctioned", names } |
 *  { status: "unavailable", reason }. Only "clear" may proceed. */
export async function screenWallet(address, env, now = Date.now()) {
  if (!isSolanaAddress(address)) return { status: "unavailable", reason: "Not a valid wallet address." };
  const apiKey = typeof env?.CHAINALYSIS_API_KEY === "string" ? env.CHAINALYSIS_API_KEY.trim() : "";
  if (!apiKey) return { status: "unavailable", reason: "Wallet screening isn't configured yet." };

  const cached = screeningCache.get(address);
  if (cached && cached.expires > now) return cached.result;

  let pending = screeningInFlight.get(address);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(CHAINALYSIS_URL + encodeURIComponent(address), {
          headers: { "X-API-Key": apiKey, accept: "application/json" },
          signal: AbortSignal.timeout(SCREENING_TIMEOUT_MS),
        });
        if (!response.ok) return { status: "unavailable", reason: `Wallet screening failed (HTTP ${response.status}).` };
        const body = await response.json();
        if (!Array.isArray(body?.identifications)) return { status: "unavailable", reason: "Wallet screening returned an unexpected answer." };
        const sanctions = body.identifications.filter((item) => String(item?.category || "").toLowerCase() === "sanctions");
        return sanctions.length
          ? { status: "sanctioned", names: sanctions.map((item) => String(item.name || "Sanctioned address")).slice(0, 5) }
          : { status: "clear" };
      } catch (error) {
        return { status: "unavailable", reason: error?.name === "TimeoutError" ? "Wallet screening timed out." : "Wallet screening is unreachable." };
      }
    })().finally(() => screeningInFlight.delete(address));
    screeningInFlight.set(address, pending);
  }
  const result = await pending;
  // Answers are cached briefly; failures aren't, so a retry really retries.
  if (result.status !== "unavailable") {
    if (screeningCache.size >= MAX_CACHE_ENTRIES) screeningCache.delete(screeningCache.keys().next().value);
    screeningCache.set(address, { result, expires: now + SCREENING_CACHE_MS[result.status] });
  }
  return result;
}

/** A refusal Response for a blocked location or a wallet that isn't
 *  cleared, or null when the action may go ahead. */
export async function refusalFor(request, env, wallet, action) {
  const geo = geoForRequest(request);
  if (geo.level === "blocked") {
    return jsonResponse(451, { code: "REGION_BLOCKED", error: `${geo.notice} (${geo.name})`, level: "blocked" });
  }
  if (wallet !== undefined) {
    const screening = await screenWallet(wallet, env);
    if (screening.status === "sanctioned") {
      return jsonResponse(403, { code: "WALLET_SANCTIONED", error: `This wallet appears on a sanctions list, so it can't ${action} on Signal.` });
    }
    if (screening.status !== "clear") {
      return jsonResponse(503, { code: "SCREENING_UNAVAILABLE", error: `${screening.reason} Please try again in a minute.` });
    }
  }
  return null;
}

export function jsonResponse(status, body, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", ...headers },
  });
}

/** For tests. */
export function resetComplianceForTests() {
  screeningCache.clear();
  screeningInFlight.clear();
}
