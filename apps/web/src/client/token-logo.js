// Logo URLs for Signal launches, read from each token's on-chain metadata:
// the Metaplex metadata account (via the same RPC the launch flow uses)
// gives the metadata JSON's URI, and that JSON's `image` is the logo.
// Loaded on demand by explore.js (a classic script) with import(), so
// pages without Signal tokens never fetch the wallet library.
//
// Returns URLs only; the caller decides whether to show them (https only)
// and renders them as <img> elements, never as HTML. Everything read here
// is third-party data: any failure resolves to null (placeholder).
import * as web3 from "./vendor/solana-web3.js";
import { metadataAddress, decodeMetadataAccount, TOKEN_METADATA_PROGRAM_ID } from "./token-metadata.js";

const IS_DEVNET = window.SIGNAL_SOLANA_CLUSTER === "devnet";
const RPC_ENDPOINT = IS_DEVNET
  ? "https://api.devnet.solana.com"
  : new URL("/api/solana/rpc", window.location.origin).toString();
const TIMEOUT_MS = 8_000;
// A metadata JSON is a few hundred bytes; anything far larger isn't one.
const MAX_METADATA_JSON_CHARS = 64 * 1024;

function isHttpsUrl(value) {
  try {
    return typeof value === "string" && value.length <= 2048 && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function resolveLogo(mintAddress) {
  try {
    const metadata = metadataAddress(web3, new web3.PublicKey(mintAddress));
    const rpc = await fetch(RPC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [metadata.toBase58(), { encoding: "base64", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!rpc.ok) return null;
    const account = (await rpc.json())?.result?.value;
    if (!account || account.owner !== TOKEN_METADATA_PROGRAM_ID) return null;
    const { uri } = decodeMetadataAccount(base64ToBytes(account.data[0]));
    if (!isHttpsUrl(uri)) return null;

    const json = await fetch(uri, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!json.ok) return null;
    const text = await json.text();
    if (text.length > MAX_METADATA_JSON_CHARS) return null;
    const image = JSON.parse(text)?.image;
    return isHttpsUrl(image) ? image : null;
  } catch {
    return null;
  }
}

const cache = new Map();

/** Resolves to the logo URL for a Signal-launched Solana mint, or null. */
export function signalLogoUrl(mintAddress) {
  if (!cache.has(mintAddress)) cache.set(mintAddress, resolveLogo(mintAddress));
  return cache.get(mintAddress);
}
