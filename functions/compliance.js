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
// Screening needs no key: the Worker downloads the official SDN list, keeps
// only its digital currency addresses, and caches them (see below). If the
// list can't be loaded, screening reports "unavailable" so callers fail safe.
import restrictions from "../config/restrictions.json" with { type: "json" };

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
// Source: the SDN list in its structured XML form from Treasury's Sanctions
// List Service (the CSV exports miss some addresses). Each sanctioned
// digital currency address appears as
//   <idType>Digital Currency Address - ETH</idType><idNumber>0x…</idNumber>
// The file is ~30 MB, so it's streamed and scanned once, and only the
// addresses (a few KB) are kept: in memory, and in Cloudflare's edge cache
// so other Worker instances nearby don't download and parse it again. The
// list is refreshed after SDN_LIST_TTL_MS (at least twice a day). If a
// refresh fails, a list up to SDN_MAX_STALE_MS old keeps being used;
// beyond that, or with no list at all, screening is "unavailable".

export const SDN_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
export const SDN_LIST_TTL_MS = 12 * 60 * 60_000;
export const SDN_MAX_STALE_MS = 48 * 60 * 60_000;
// The list has ~1,000 digital currency addresses; far fewer means the
// download wasn't really the SDN list (an error page, a cut-off file).
export const SDN_MIN_ADDRESSES = 100;
const SDN_DOWNLOAD_TIMEOUT_MS = 60_000;
const SDN_EDGE_CACHE_KEY = "https://ofac-sdn.cache/digital-currency-addresses-v1";
const ID_TYPE_OPEN = "<idType>Digital Currency Address - ";

let sdnList = null; // { addresses: Set, publishDate, fetchedAt }
let sdnLoading = null;

export function isSolanaAddress(value) {
  return typeof value === "string" && SOLANA_ADDRESS.test(value);
}

/** Addresses the screening accepts: Solana, and EVM (Base/BNB wallets). */
export function isScreenableAddress(value) {
  return isSolanaAddress(value) || (typeof value === "string" && EVM_ADDRESS.test(value));
}

/** EVM addresses are case-insensitive (checksum casing varies); others,
 *  like Solana's base58, are compared exactly. */
export function normalizeAddress(address) {
  const value = String(address).trim();
  return /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value;
}

/** Streams SDN.XML and returns { addresses: Set, currencies, publishDate },
 *  keeping only digital currency addresses. Chunks are scanned with a small
 *  carry-over, so an entry split across chunks is still found. */
export async function parseSdnXml(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const addresses = new Set();
  const currencies = {};
  let publishDate = null;
  let pending = "";
  const scan = (text, final) => {
    let from = 0;
    for (;;) {
      const start = text.indexOf(ID_TYPE_OPEN, from);
      if (start < 0) break;
      const typeEnd = text.indexOf("</idType>", start);
      const numberOpen = typeEnd < 0 ? -1 : text.indexOf("<idNumber>", typeEnd);
      const numberEnd = numberOpen < 0 ? -1 : text.indexOf("</idNumber>", numberOpen);
      if (numberEnd < 0) {
        // Incomplete at the end of this chunk: keep it for the next one.
        return final ? "" : text.slice(start);
      }
      const currency = text.slice(start + ID_TYPE_OPEN.length, typeEnd).trim();
      const address = text.slice(numberOpen + "<idNumber>".length, numberEnd).trim();
      if (address) {
        addresses.add(normalizeAddress(address));
        currencies[currency] = (currencies[currency] || 0) + 1;
      }
      from = numberEnd;
    }
    // Keep a short tail in case the next marker starts across the boundary.
    return final ? "" : text.slice(Math.max(from, text.length - ID_TYPE_OPEN.length));
  };
  for (;;) {
    const { done, value } = await reader.read();
    const text = pending + (done ? decoder.decode() : decoder.decode(value, { stream: true }));
    if (!publishDate) {
      const match = /<Publish_Date>([^<]+)<\/Publish_Date>/.exec(text);
      if (match) publishDate = match[1].trim();
    }
    pending = scan(text, done);
    if (done) break;
  }
  return { addresses, currencies, publishDate };
}

async function downloadSdnList(now) {
  const response = await fetch(SDN_XML_URL, { signal: AbortSignal.timeout(SDN_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`OFAC list download failed (HTTP ${response.status}).`);
  const parsed = await parseSdnXml(response.body);
  if (parsed.addresses.size < SDN_MIN_ADDRESSES) {
    throw new Error(`The OFAC list download looked incomplete (${parsed.addresses.size} addresses).`);
  }
  return { addresses: parsed.addresses, publishDate: parsed.publishDate, fetchedAt: now };
}

async function readEdgeCache(now) {
  if (typeof caches === "undefined") return null;
  try {
    const hit = await caches.default.match(new Request(SDN_EDGE_CACHE_KEY));
    if (!hit) return null;
    const cached = await hit.json();
    if (!Array.isArray(cached?.addresses) || cached.addresses.length < SDN_MIN_ADDRESSES) return null;
    if (!(now - cached.fetchedAt < SDN_LIST_TTL_MS)) return null;
    return { addresses: new Set(cached.addresses), publishDate: cached.publishDate, fetchedAt: cached.fetchedAt };
  } catch {
    return null;
  }
}

async function writeEdgeCache(list) {
  if (typeof caches === "undefined") return;
  const body = JSON.stringify({ addresses: [...list.addresses], publishDate: list.publishDate, fetchedAt: list.fetchedAt });
  const ttlSeconds = Math.floor(SDN_LIST_TTL_MS / 1000);
  await caches.default
    .put(new Request(SDN_EDGE_CACHE_KEY), new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` } }))
    .catch(() => {});
}

/** The current SDN address list, loading or refreshing it when needed.
 *  Concurrent callers share one download. Throws when no usable list. */
export async function sdnAddressList(now = Date.now()) {
  if (sdnList && now - sdnList.fetchedAt < SDN_LIST_TTL_MS) return sdnList;
  if (!sdnLoading) {
    sdnLoading = (async () => {
      const cached = await readEdgeCache(now);
      if (cached) return cached;
      const fresh = await downloadSdnList(now);
      await writeEdgeCache(fresh);
      return fresh;
    })().finally(() => {
      sdnLoading = null;
    });
  }
  try {
    sdnList = await sdnLoading;
    return sdnList;
  } catch (error) {
    // A slightly old list is still a real list; beyond that, fail safe.
    if (sdnList && now - sdnList.fetchedAt < SDN_MAX_STALE_MS) return sdnList;
    throw error;
  }
}

/** { status: "clear" } | { status: "sanctioned", names } |
 *  { status: "unavailable", reason }. Only "clear" may proceed. */
export async function screenWallet(address, _env, now = Date.now()) {
  if (!isScreenableAddress(address)) return { status: "unavailable", reason: "Not a valid wallet address." };
  let list;
  try {
    list = await sdnAddressList(now);
  } catch (error) {
    // The cause (an HTTP status or an address count; never anything secret)
    // is included so a failing download can be diagnosed from outside.
    const cause = error?.name === "TimeoutError" ? "download timed out" : String(error?.message || "unknown error").slice(0, 120);
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
  sdnList = null;
  sdnLoading = null;
}
