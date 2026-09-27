// ANS-104 data items: the signed envelope Arweave bundlers (here ArDrive
// Turbo) accept for permanent storage. Written by hand instead of pulling
// in arbundles, which isn't browser-friendly and brings its own crypto
// stack; this needs only browser crypto (SHA-256/384) and the creator's
// wallet signature.
//
// Signature type 4 is ANS-104's "Solana" type: ed25519, but the wallet
// signs the deep hash as a hex string (UTF-8 text) rather than raw bytes,
// so Phantom's signMessage shows readable text instead of refusing or
// warning about binary data. Verifiers do the same hex step.
//
// Layout (all integers little-endian):
//   u16 signature type | signature | owner | target flag [+32] |
//   anchor flag [+32] | u64 tag count | u64 tag bytes | tags (Avro) | data

export const SIGNATURE_TYPE_SOLANA = 4;
const SIGNATURE_LENGTH = 64;
const OWNER_LENGTH = 32;
const MAX_TAGS = 128;
const MAX_TAG_NAME_BYTES = 1024;
const MAX_TAG_VALUE_BYTES = 3072;

const utf8 = new TextEncoder();

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function digest(algorithm, bytes) {
  return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
}

/** Arweave's deep hash (SHA-384) over nested byte arrays. */
export async function deepHash(data) {
  if (Array.isArray(data)) {
    let acc = await digest("SHA-384", concat(utf8.encode("list"), utf8.encode(String(data.length))));
    for (const chunk of data) acc = await digest("SHA-384", concat(acc, await deepHash(chunk)));
    return acc;
  }
  const tag = await digest("SHA-384", concat(utf8.encode("blob"), utf8.encode(String(data.byteLength))));
  return digest("SHA-384", concat(tag, await digest("SHA-384", data)));
}

// Avro "long": zigzag, then base-128 varint. Counts and lengths here are
// never negative, so zigzag is just doubling.
function avroLong(value) {
  let v = value * 2;
  const out = [];
  while (v > 0x7f) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return Uint8Array.from(out);
}

/** Tags as ANS-104 stores them: an Avro array of {name: bytes, value: bytes}. */
export function encodeTags(tags) {
  if (tags.length === 0) return new Uint8Array(0);
  if (tags.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} tags are allowed.`);
  const parts = [avroLong(tags.length)];
  for (const { name, value } of tags) {
    const nameBytes = utf8.encode(name);
    const valueBytes = utf8.encode(value);
    if (nameBytes.length === 0 || nameBytes.length > MAX_TAG_NAME_BYTES) throw new Error("Invalid tag name.");
    if (valueBytes.length === 0 || valueBytes.length > MAX_TAG_VALUE_BYTES) throw new Error("Invalid tag value.");
    parts.push(avroLong(nameBytes.length), nameBytes, avroLong(valueBytes.length), valueBytes);
  }
  parts.push(Uint8Array.of(0));
  return concat(...parts);
}

function u16le(value) {
  return Uint8Array.of(value & 0xff, value >> 8);
}

function u64le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The exact text the wallet signs for a data item (hex of its deep hash). */
export async function signingMessage({ owner, tags, data }) {
  const hash = await deepHash([
    utf8.encode("dataitem"),
    utf8.encode("1"),
    utf8.encode(String(SIGNATURE_TYPE_SOLANA)),
    owner,
    new Uint8Array(0), // no target
    new Uint8Array(0), // no anchor
    encodeTags(tags),
    data,
  ]);
  return utf8.encode(toHex(hash));
}

/** Builds and signs one data item. `owner` is the 32-byte Solana public
 *  key; `signMessage(bytes)` must return that key's 64-byte ed25519
 *  signature of `bytes` (Phantom: provider.signMessage(bytes, "utf8")).
 *  Returns the serialized item and its Arweave id. */
export async function createSignedDataItem({ owner, tags, data, signMessage }) {
  if (!(owner instanceof Uint8Array) || owner.length !== OWNER_LENGTH) throw new Error("Owner must be a 32-byte public key.");
  const signature = await signMessage(await signingMessage({ owner, tags, data }));
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) {
    throw new Error("The wallet returned an invalid signature.");
  }
  const tagBytes = encodeTags(tags);
  const bytes = concat(
    u16le(SIGNATURE_TYPE_SOLANA),
    signature,
    owner,
    Uint8Array.of(0), // no target
    Uint8Array.of(0), // no anchor
    u64le(tags.length),
    u64le(tagBytes.length),
    tagBytes,
    data,
  );
  return { bytes, id: await dataItemId(signature), signature };
}

/** A data item's id: base64url(SHA-256(signature)). */
export async function dataItemId(signature) {
  return base64url(await digest("SHA-256", signature));
}
