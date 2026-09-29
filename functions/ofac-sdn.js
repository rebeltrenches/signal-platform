// The OFAC SDN list's digital currency addresses: parsing the official
// XML, and the small JSON file the Worker screens against.
//
// Cloudflare Workers can't connect to Treasury's list server (TLS handshake
// fails, HTTP 525), so the list is prepared elsewhere: a scheduled GitHub
// Actions job (.github/workflows/ofac-sdn-list.yml, scripts/ofac-sdn-list.mjs)
// downloads SDN.XML, extracts the addresses with parseSdnXml, and publishes
// buildListFile's JSON to the repo's `ofac-data` branch. The Worker only
// reads that JSON (a few KB) and checks it with validateListFile.
// No imports: used by the Worker, the job and the tests alike.

export const SDN_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
// The list has ~1,000 digital currency addresses; far fewer means the
// download wasn't really the SDN list (an error page, a cut-off file).
export const SDN_MIN_ADDRESSES = 100;
// A list file older than this is not trusted (the job runs every 6 hours).
export const SDN_MAX_AGE_MS = 48 * 60 * 60_000;
export const LIST_FILE_FORMAT = "signal-ofac-sdn-addresses/1";
const ID_TYPE_OPEN = "<idType>Digital Currency Address - ";

/** EVM addresses are case-insensitive (checksum casing varies); others,
 *  like Solana's base58, are compared exactly. */
export function normalizeAddress(address) {
  const value = String(address).trim();
  return /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value;
}

/** Streams SDN.XML and returns { addresses: Set, currencies, publishDate },
 *  keeping only digital currency addresses, e.g.
 *    <idType>Digital Currency Address - ETH</idType><idNumber>0x…</idNumber>
 *  Chunks are scanned with a small carry-over, so an entry split across
 *  chunks is still found. */
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
      if (numberEnd < 0) return final ? "" : text.slice(start); // finish with the next chunk
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

/** The JSON the Worker reads. Throws rather than produce a list that
 *  doesn't look like the real one. */
export function buildListFile(parsed, now = Date.now()) {
  if (parsed.addresses.size < SDN_MIN_ADDRESSES) {
    throw new Error(`The SDN download looked incomplete (${parsed.addresses.size} digital currency addresses).`);
  }
  return {
    format: LIST_FILE_FORMAT,
    source: SDN_XML_URL,
    publishDate: parsed.publishDate,
    generatedAt: new Date(now).toISOString(),
    count: parsed.addresses.size,
    currencies: parsed.currencies,
    addresses: [...parsed.addresses].sort(),
  };
}

/** Checks a list file before it's used for screening; returns
 *  { addresses: Set, publishDate, generatedAt } or throws with the reason. */
export function validateListFile(file, now = Date.now()) {
  if (!file || file.format !== LIST_FILE_FORMAT || !Array.isArray(file.addresses)) {
    throw new Error("the list file isn't in the expected format");
  }
  if (file.addresses.length < SDN_MIN_ADDRESSES || file.count !== file.addresses.length) {
    throw new Error(`the list file looks incomplete (${file.addresses.length} addresses)`);
  }
  const generatedAt = Date.parse(file.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error("the list file has no valid date");
  if (now - generatedAt > SDN_MAX_AGE_MS) throw new Error(`the list file is too old (made ${file.generatedAt})`);
  if (generatedAt - now > 60 * 60_000) throw new Error("the list file is dated in the future");
  // Entries that can't be addresses are ignored, not trusted; the rest must
  // still look like the real list.
  const addresses = new Set(file.addresses.filter((a) => typeof a === "string" && /^[A-Za-z0-9]{20,120}$/.test(a)).map(normalizeAddress));
  if (addresses.size < SDN_MIN_ADDRESSES) throw new Error(`the list file looks incomplete (${addresses.size} valid addresses)`);
  return { addresses, publishDate: file.publishDate || null, generatedAt };
}
