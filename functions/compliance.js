// Regional restrictions and wallet sanctions screening, shared by the
// Worker routes. Levels come only from config/restrictions.json (see its
// comments); nothing here lists countries.
//
//   Level 1 "blocked":   no connect, launch or trade (browsing allowed)
//   Level 2 "regulated": allowed after an extra region-specific warning
//   Level 3:             wallets screened against the US Treasury's OFAC
//                        SDN list (its digital currency addresses)
//
// Location is Cloudflare's: request.cf.country (same as the CF-IPCountry
// header) and request.cf.regionCode for sanctioned sub-national regions.
// Screening needs no key. If the sanctions list can't be loaded, screening
// reports "unavailable" so callers fail safe.
import restrictions from "../config/restrictions.json" with { type: "json" };
import { normalizeAddress, validateListFile, SDN_MAX_AGE_MS } from "./ofac-sdn.js";

export { normalizeAddress, SDN_MAX_AGE_MS };
export const RESTRICTIONS = restrictions;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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
// OFAC SDN list screening
//
// Cloudflare can't connect to Treasury's list server (TLS handshake fails,
// HTTP 525), so the list is prepared by a scheduled GitHub Actions job
// (.github/workflows/ofac-sdn-list.yml) every 6 hours and published as a
// small JSON file (~40 KB, ~1,000 addresses) on the repo's `ofac-data`
// branch; see functions/ofac-sdn.js. The Worker reads that file (no
// parsing work to speak of), keeps it in memory and re-reads it hourly, falling back to a CDN mirror
// of the same file.
// A file older than SDN_MAX_AGE_MS (48 hours, by its own creation time),
// incomplete or malformed is never used: screening is then "unavailable".

export const OFAC_LIST_URL = "https://raw.githubusercontent.com/rebeltrenches/signal-platform/ofac-data/ofac-sdn-addresses.json";
// The same file through jsDelivr's CDN, tried when GitHub's raw host can't be
// reached (it can rate-limit shared Cloudflare egress). jsDelivr may lag the
// branch by up to 12 hours, which the 48-hour limit on the file's own
// creation time covers.
export const OFAC_LIST_MIRROR_URL = "https://cdn.jsdelivr.net/gh/rebeltrenches/signal-platform@ofac-data/ofac-sdn-addresses.json";
export const LIST_REFRESH_MS = 60 * 60_000;
// After a failed read, the failure is reused for at most this long (so a
// burst of checks doesn't each wait on a download that's failing), then the
// next check tries again. Never longer: a fixed file is picked up quickly.
export const LIST_FAILURE_BACKOFF_MS = 30_000;
// Sent on screening answers so the code version behind an answer is visible
// from outside (e.g. an old commit's preview URL still running old code).
export const SCREENING_VERSION = "ofac-json-2";
const LIST_TIMEOUT_MS = 10_000;

let sdnList = null; // { addresses: Set, publishDate, generatedAt, loadedAt }
let sdnLoading = null;
let lastFailure = null; // { at, error }

export function isSolanaAddress(value) {
  return typeof value === "string" && SOLANA_ADDRESS.test(value);
}

/** Addresses the screening accepts: Solana, and EVM (Base/BNB wallets). */
export function isScreenableAddress(value) {
  return isSolanaAddress(value) || (typeof value === "string" && EVM_ADDRESS.test(value));
}

async function readListFile(url, now) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch (error) {
    throw new Error(error?.name === "TimeoutError" ? "download timed out" : `download failed: ${String(error?.message || error).slice(0, 60)}`);
  }
  if (!response.ok) throw new Error(`list file download failed (HTTP ${response.status})`);
  let file;
  try {
    file = await response.json();
  } catch {
    throw new Error("the list file isn't valid JSON");
  }
  return { ...validateListFile(file, now), loadedAt: now };
}

/** The GitHub file, then the mirror. Throws with both causes. */
async function loadListFile(env, now) {
  const primary = typeof env?.OFAC_LIST_URL === "string" && env.OFAC_LIST_URL.startsWith("https://") ? env.OFAC_LIST_URL : OFAC_LIST_URL;
  const causes = [];
  for (const [name, url] of [["GitHub", primary], ["mirror", OFAC_LIST_MIRROR_URL]]) {
    try {
      return await readListFile(url, now);
    } catch (error) {
      causes.push(`${name}: ${error.message}`);
    }
  }
  throw new Error(causes.join("; "));
}

const trusted = (list, now) => list && now - list.generatedAt <= SDN_MAX_AGE_MS;

/** The current SDN address list, loading or re-reading it when needed.
 *  Concurrent callers share one read; a failure is reused for at most
 *  LIST_FAILURE_BACKOFF_MS. Throws when there's no trustworthy list. */
export async function sdnAddressList(env, now = Date.now()) {
  if (trusted(sdnList, now) && now - sdnList.loadedAt < LIST_REFRESH_MS) return sdnList;
  const backingOff = lastFailure && now >= lastFailure.at && now - lastFailure.at < LIST_FAILURE_BACKOFF_MS;
  if (backingOff) {
    if (trusted(sdnList, now)) return sdnList;
    throw lastFailure.error;
  }
  if (!sdnLoading) {
    sdnLoading = loadListFile(env, now)
      .then((list) => {
        lastFailure = null;
        return list;
      }, (error) => {
        lastFailure = { at: now, error };
        throw error;
      })
      .finally(() => {
        sdnLoading = null;
      });
  }
  try {
    sdnList = await sdnLoading;
    return sdnList;
  } catch (error) {
    // The list already held is still fine to use while it's under 48 hours old.
    if (trusted(sdnList, now)) return sdnList;
    throw error;
  }
}

/** { status: "clear" } | { status: "sanctioned", names } |
 *  { status: "unavailable", reason }. Only "clear" may proceed. */
export async function screenWallet(address, env, now = Date.now()) {
  if (!isScreenableAddress(address)) return { status: "unavailable", reason: "Not a valid wallet address." };
  let list;
  try {
    list = await sdnAddressList(env, now);
  } catch (error) {
    // The cause (an HTTP status, an address count or a date; never anything
    // secret) is included so a failing load can be diagnosed from outside.
    const cause = String(error?.message || "unknown error").slice(0, 200);
    return { status: "unavailable", reason: `The OFAC sanctions list couldn't be loaded (${cause}).` };
  }
  if (list.addresses.has(normalizeAddress(address))) {
    return { status: "sanctioned", names: [`OFAC SDN list${list.publishDate ? ` (published ${list.publishDate})` : ""}`] };
  }
  return { status: "clear" };
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
      return jsonResponse(503, { code: "SCREENING_UNAVAILABLE", error: `${screening.reason} Please try again in a minute.` }, { "x-signal-screening": SCREENING_VERSION });
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
  sdnList = null;
  sdnLoading = null;
  lastFailure = null;
}
