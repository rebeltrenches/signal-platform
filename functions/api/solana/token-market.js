// GET /api/solana/token-market?mint=<address>
//
// Market data for a Solana token's workspace page, read from real sources
// only — never estimated:
//   - While a pump.fun bonding curve is active, the curve read on-chain:
//     spot price from its virtual reserves, market cap from price × the
//     mint's real supply (SOL, and USD with a live Jupiter SOL price),
//     liquidity = real SOL in the curve, and progress from the real tokens
//     sold (pump.fun's Global account holds the starting amount).
//     pump.fun "Mayhem Mode" coins mint an extra 1B into pump.fun's Mayhem
//     wallet. When a coin's own data confirms it (curve flag AND mint supply
//     exactly twice the curve's AND the wallet's token account readable),
//     the headline market cap leaves out that wallet's exact balance and the
//     full-supply figure is returned alongside. If any part is uncertain,
//     the full on-chain supply is used, with a note saying why.
//   - Otherwise (no curve, or it has completed) the deepest DEX pair on DEX
//     Screener. Its listing of the bonding curve itself doesn't count.
//   - Holders: an exact count of accounts with a balance, from Helius DAS
//     (getTokenAccounts), up to one page (1,000); a full page is reported
//     as "N+", never extrapolated.
//   - Logo: the token's on-chain metadata — Metaplex, or Token-2022's own
//     metadata extension (newer pump.fun tokens) — then that JSON's image
//     (retrying another IPFS gateway if one refuses), falling back to DEX
//     Screener's image. https only; the page renders it as an <img>.
// Anything that can't be read is returned as { unavailable: reason }.
//
// The endpoint is public, so it guards the Helius quota: the mint must be a
// valid address (checked before any network call), responses are cached
// (including "not found"), concurrent lookups of one mint share one
// request, and uncached lookups are rate-limited per IP (the
// TOKEN_MARKET_RATE_LIMITER binding when configured, else per instance).

const FALLBACK_RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
// pump.fun "Mayhem Mode": such coins mint a second 1B into pump.fun's
// Mayhem wallet, the Mayhem program's PDA ["sol-vault"] (checked on 10
// Mayhem coins, 2026-09-28). The curve marks these coins with a flag
// right after its creator field.
const MAYHEM_PROGRAM_ID = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";
const CURVE_MAYHEM_FLAG_OFFSET = 81;
// Anchor account discriminators: sha256("account:<Name>")[0..8].
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127];
const TOKEN_METADATA_EXTENSION = 19;
const HOLDERS_PAGE_LIMIT = 1000;

export const CACHE_TTL_MS = {
  found: 20_000,
  notFound: 5 * 60_000,
  error: 10_000,
  solPrice: 60_000,
  global: 60 * 60_000,
  logo: 60 * 60_000,
  logoMiss: 60_000,
};
export const RATE_LIMIT = { requests: 20, windowMs: 60_000 };
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_METADATA_JSON_BYTES = 64 * 1024;
const MAX_MEMORY_CACHE_ENTRIES = 2_000;

// ---------------------------------------------------------------------------
// Base58 and program-derived addresses (no Solana library in the Worker)

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** 32 bytes for a valid Solana address, else null. */
export function decodeAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return null;
  let n = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return bytes.length === 32 ? Uint8Array.from(bytes) : null;
}

export function encodeAddress(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const P = 2n ** 255n - 19n;
const D = (-121665n * modPow(121666n, P - 2n)) % P;
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);
function mod(a) {
  const r = a % P;
  return r >= 0n ? r : r + P;
}
function modPow(base, exp) {
  let result = 1n;
  let b = ((base % P) + P) % P;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}
/** Whether 32 bytes decode to a point on the ed25519 curve. A program
 *  address must NOT be (so no private key can exist for it). */
function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  const sign = bytes[31] >> 7;
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const v3 = mod(v * v * v);
  let x = mod(u * v3 * modPow(mod(u * v3 * v3 * v), (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === u) {
    // root found
  } else if (vx2 === mod(-u)) {
    x = mod(x * SQRT_M1);
  } else {
    return false;
  }
  return !(x === 0n && sign === 1);
}

const encoder = new TextEncoder();
/** findProgramAddress: the first bump from 255 down whose hash is off-curve. */
export async function findProgramAddress(seeds, programId) {
  const program = decodeAddress(programId);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const parts = [...seeds, Uint8Array.of(bump), program, encoder.encode("ProgramDerivedAddress")];
    const buffer = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      buffer.set(part, offset);
      offset += part.length;
    }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    if (!isOnCurve(hash)) return encodeAddress(hash);
  }
  throw new Error("No program address found");
}

// ---------------------------------------------------------------------------
// Account decoding

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
function u64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}
function startsWith(bytes, prefix) {
  return prefix.every((b, i) => bytes[i] === b);
}
function readBorshString(bytes, offset) {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  if (offset + 4 + length > bytes.length) throw new Error("truncated string");
  const value = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + length)).replace(/\u0000+$/, "").trim();
  return { value, next: offset + 4 + length };
}

/** SPL / Token-2022 mint: supply and decimals (same base layout). */
export function decodeMint(bytes) {
  if (bytes.length < 82) throw new Error("not a mint");
  return { supply: u64(bytes, 36), decimals: bytes[44] };
}

/** Token-2022's TokenMetadata extension (name, symbol, uri), or null. */
export function decodeToken2022Metadata(bytes) {
  // Extensions follow the 165-byte base area and a 1-byte account type (1 = mint).
  if (bytes.length <= 166 || bytes[165] !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 166;
  while (offset + 4 <= bytes.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (type === TOKEN_METADATA_EXTENSION) {
      let cursor = offset + 4 + 64; // update authority + mint
      const name = readBorshString(bytes, cursor);
      const symbol = readBorshString(bytes, name.next);
      const uri = readBorshString(bytes, symbol.next);
      return { name: name.value, symbol: symbol.value, uri: uri.value };
    }
    if (type === 0 && length === 0) break;
    offset += 4 + length;
  }
  return null;
}

/** Metaplex metadata account (key 4): name, symbol, uri. */
export function decodeMetaplexMetadata(bytes) {
  if (bytes[0] !== 4) return null;
  const name = readBorshString(bytes, 65);
  const symbol = readBorshString(bytes, name.next);
  const uri = readBorshString(bytes, symbol.next);
  return { name: name.value, symbol: symbol.value, uri: uri.value };
}

export function decodeBondingCurve(bytes) {
  if (bytes.length < 49 || !startsWith(bytes, BONDING_CURVE_DISCRIMINATOR)) return null;
  return {
    virtualTokenReserves: u64(bytes, 8),
    virtualSolReserves: u64(bytes, 16),
    realTokenReserves: u64(bytes, 24),
    realSolReserves: u64(bytes, 32),
    tokenTotalSupply: u64(bytes, 40),
    complete: bytes[48] === 1,
    mayhemFlag: bytes.length > CURVE_MAYHEM_FLAG_OFFSET && bytes[CURVE_MAYHEM_FLAG_OFFSET] === 1,
  };
}

/** SPL / Token-2022 token account: mint, owner, amount (same base layout). */
export function decodeTokenAccount(bytes) {
  if (bytes.length < 72) return null;
  return { mint: encodeAddress(bytes.subarray(0, 32)), owner: encodeAddress(bytes.subarray(32, 64)), amount: u64(bytes, 64) };
}

/** Whether this coin is a pump.fun Mayhem Mode coin, from its own data:
 *  the curve's Mayhem flag AND a mint supply of exactly twice the curve's,
 *  plus a readable Mayhem-wallet token account for this mint. Anything
 *  less certain is reported as `uncertain`, never guessed. */
export function mayhemStatus({ curve, mintInfo, mint, mintProgram, vault, vaultTokenAccount }) {
  if (!curve) return { detected: false };
  const doubled = mintInfo.supply === 2n * curve.tokenTotalSupply;
  if (!curve.mayhemFlag && !doubled) return { detected: false };
  if (!curve.mayhemFlag) return { uncertain: "The mint's supply is twice the curve's, but the curve isn't marked Mayhem Mode." };
  if (!doubled) return { uncertain: "The curve is marked Mayhem Mode, but the mint's supply isn't twice the curve's." };
  const account = vaultTokenAccount && vaultTokenAccount.owner === mintProgram ? decodeTokenAccount(vaultTokenAccount.data) : null;
  if (!account || account.mint !== mint || account.owner !== vault) {
    return { uncertain: "The curve is marked Mayhem Mode, but the Mayhem wallet's holdings couldn't be read." };
  }
  if (account.amount > mintInfo.supply) return { uncertain: "The Mayhem wallet's balance is larger than the supply." };
  return { detected: true, wallet: vault, walletBalance: account.amount };
}

export function decodeGlobal(bytes) {
  if (bytes.length < 105 || !startsWith(bytes, GLOBAL_DISCRIMINATOR)) return null;
  return {
    initialVirtualTokenReserves: u64(bytes, 73),
    initialRealTokenReserves: u64(bytes, 89),
  };
}

// ---------------------------------------------------------------------------
// Upstream calls

function rpcUrls(env) {
  const configured = typeof env?.SOLANA_RPC_URL === "string" ? env.SOLANA_RPC_URL.trim() : "";
  return [...new Set([...(configured.startsWith("https://") ? [configured] : []), ...FALLBACK_RPC_URLS])];
}
function heliusUrl(env) {
  const configured = typeof env?.SOLANA_RPC_URL === "string" ? env.SOLANA_RPC_URL.trim() : "";
  return configured.startsWith("https://") ? configured : null;
}

async function rpcCall(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body?.error) throw new Error(`RPC error ${body.error.code ?? ""}`.trim());
  return body.result;
}

/** getMultipleAccounts on the configured RPC, then public fallbacks. */
async function getAccounts(addresses, env) {
  let lastError = new Error("RPC unavailable");
  for (const url of rpcUrls(env)) {
    try {
      const result = await rpcCall(url, "getMultipleAccounts", [addresses, { encoding: "base64", commitment: "confirmed" }]);
      if (!Array.isArray(result?.value) || result.value.length !== addresses.length) throw new Error("RPC response");
      return result.value.map((account) => account && { owner: account.owner, data: base64ToBytes(account.data[0]) });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// DEX Screener also lists pump.fun bonding curves themselves (dexId
// "pumpfun"), without liquidity; those aren't DEX pairs — the curve is read
// on-chain instead. Its image is still usable as a logo fallback.
const BONDING_CURVE_DEX_IDS = new Set(["pumpfun"]);

async function dexScreenerPair(mint) {
  try {
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!response.ok) return { error: `DEX Screener HTTP ${response.status}` };
    const pairs = await response.json();
    const own = (Array.isArray(pairs) ? pairs : []).filter((pair) => pair?.baseToken?.address === mint);
    const imageUrl = own.map((pair) => pair?.info?.imageUrl).find(isHttpsUrl) || null;
    const dexPairs = own.filter((pair) => !BONDING_CURVE_DEX_IDS.has(String(pair?.dexId)));
    dexPairs.sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
    return { pair: dexPairs[0] || null, imageUrl };
  } catch {
    return { error: "DEX Screener unreachable" };
  }
}

const shared = { solPrice: null, global: null, vault: null };

/** pump.fun's Mayhem wallet: the Mayhem program's PDA ["sol-vault"]. */
async function mayhemVault() {
  shared.vault = shared.vault || (await findProgramAddress([encoder.encode("sol-vault")], MAYHEM_PROGRAM_ID));
  return shared.vault;
}

async function solUsdPrice(env, now) {
  if (shared.solPrice && shared.solPrice.expires > now) return shared.solPrice.value;
  const apiKey = typeof env?.JUPITER_API_KEY === "string" ? env.JUPITER_API_KEY.trim() : "";
  const url = `${apiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag"}/price/v3?ids=${WRAPPED_SOL_MINT}`;
  try {
    const response = await fetch(url, {
      headers: apiKey ? { "x-api-key": apiKey } : {},
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const price = response.ok ? Number((await response.json())?.[WRAPPED_SOL_MINT]?.usdPrice) : NaN;
    if (!(price > 0)) return null;
    shared.solPrice = { value: price, expires: now + CACHE_TTL_MS.solPrice };
    return price;
  } catch {
    return null;
  }
}

async function pumpGlobal(env, now) {
  if (shared.global && shared.global.expires > now) return shared.global.value;
  const address = await findProgramAddress([encoder.encode("global")], PUMP_PROGRAM_ID);
  const [account] = await getAccounts([address], env);
  const value = account && account.owner === PUMP_PROGRAM_ID ? decodeGlobal(account.data) : null;
  if (value) shared.global = { value, expires: now + CACHE_TTL_MS.global };
  return value;
}

/** Exact holder count (accounts with a balance, distinct owners) from one
 *  DAS page; `capped` when the page is full, i.e. there may be more. */
async function holderCount(mint, env) {
  const url = heliusUrl(env);
  if (!url) return { unavailable: "Holder counting needs the Helius RPC (SOLANA_RPC_URL), which isn't configured." };
  try {
    const result = await rpcCall(url, "getTokenAccounts", {
      mint,
      page: 1,
      limit: HOLDERS_PAGE_LIMIT,
      options: { showZeroBalance: false },
    });
    const accounts = Array.isArray(result?.token_accounts) ? result.token_accounts : null;
    if (!accounts) return { unavailable: "Helius returned no holder data." };
    const owners = new Set(accounts.filter((a) => /^\d+$/.test(String(a?.amount)) && BigInt(a.amount) > 0n).map((a) => a.owner));
    return { count: owners.size, capped: accounts.length >= HOLDERS_PAGE_LIMIT, source: "Helius" };
  } catch (error) {
    return { unavailable: `Helius holder lookup failed (${error.message}).` };
  }
}

function isHttpsUrl(value) {
  try {
    return typeof value === "string" && value.length <= 2048 && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// The same IPFS content through another public gateway, for when one
// rate-limits us (ipfs.io often answers 429).
const IPFS_GATEWAYS = ["https://ipfs.io", "https://dweb.link"];
function metadataUrls(uri) {
  const match = /^https:\/\/[^/]+(\/ipfs\/.+)$/.exec(uri);
  if (!match || !IPFS_GATEWAYS.some((gateway) => uri.startsWith(gateway + "/"))) return [uri];
  return [uri, ...IPFS_GATEWAYS.map((gateway) => gateway + match[1]).filter((url) => url !== uri)];
}

async function metadataImage(uri) {
  if (!isHttpsUrl(uri)) return { unavailable: "The token's metadata link isn't an https URL." };
  let reason = "Metadata file couldn't be read.";
  for (const url of metadataUrls(uri)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!response.ok) {
        reason = `Metadata file HTTP ${response.status}.`;
        continue;
      }
      const text = await response.text();
      if (text.length > MAX_METADATA_JSON_BYTES) return { unavailable: "Metadata file is too large." };
      const image = JSON.parse(text)?.image;
      return isHttpsUrl(image) ? { url: image, source: "on-chain metadata" } : { unavailable: "The metadata has no https image." };
    } catch {
      reason = "Metadata file couldn't be read.";
    }
  }
  return { unavailable: reason };
}

// Logos rarely change: found ones are kept for an hour, misses briefly.
const logoCache = new Map(); // mint -> { value, expires }
async function tokenLogo(mint, metadata, dexImage, now) {
  const cached = logoCache.get(mint);
  if (cached && cached.expires > now) return cached.value;
  let logo = metadata?.uri ? await metadataImage(metadata.uri) : unavailable("No on-chain metadata found for this token.");
  if (!logo.url && dexImage) logo = { url: dexImage, source: "DEX Screener" };
  if (logoCache.size >= MAX_MEMORY_CACHE_ENTRIES) logoCache.delete(logoCache.keys().next().value);
  logoCache.set(mint, { value: logo, expires: now + (logo.url ? CACHE_TTL_MS.logo : CACHE_TTL_MS.logoMiss) });
  return logo;
}

// ---------------------------------------------------------------------------
// Assembling the response

const unavailable = (reason) => ({ unavailable: reason });
const value = (v, unit) => ({ value: v, unit });

/** Base units ÷ 10^decimals as a JS number (display precision). */
function toNumber(amount, decimals) {
  return Number(amount) / 10 ** decimals;
}

const formatTokens = (n) => Math.round(n).toLocaleString("en-US");

export function curveMetrics(curve, mint, global, solUsd, mayhem = { detected: false }) {
  const tokens = toNumber(curve.virtualTokenReserves, mint.decimals);
  const priceSol = tokens > 0 ? toNumber(curve.virtualSolReserves, 9) / tokens : null;
  // The mint's actual on-chain supply. For a confirmed Mayhem Mode coin the
  // headline market cap leaves out what pump.fun's Mayhem wallet holds
  // (an exact on-chain balance); the full-supply figure is returned too.
  const supply = toNumber(mint.supply, mint.decimals);
  const mayhemTokens = mayhem.detected ? toNumber(mayhem.walletBalance, mint.decimals) : 0;
  const counted = supply - mayhemTokens;
  const marketCapSol = priceSol === null ? null : priceSol * counted;
  const liquiditySol = toNumber(curve.realSolReserves, 9);
  const usd = (sol) => (solUsd && sol !== null ? value(sol * solUsd, "USD") : unavailable("Live SOL/USD price unavailable (Jupiter)."));
  const marketCapBasis = mayhem.detected
    ? `Excludes ${formatTokens(mayhemTokens)} tokens held by pump.fun's Mayhem wallet (${formatTokens(counted)} of ${formatTokens(supply)}).`
    : mayhem.uncertain
      ? `Full on-chain supply (${formatTokens(supply)}). ${mayhem.uncertain}`
      : `Full on-chain supply (${formatTokens(supply)}).`;
  const fullSupply = mayhem.detected && priceSol !== null
    ? { marketCapFullSupply: { sol: value(priceSol * supply, "SOL"), usd: usd(priceSol * supply) } }
    : {};
  let progress = unavailable("pump.fun's Global account couldn't be read.");
  if (curve.complete) progress = value(100, "%");
  else if (global && global.initialRealTokenReserves > 0n) {
    const sold = global.initialRealTokenReserves - curve.realTokenReserves;
    progress = value(Math.max(0, Math.min(100, (Number(sold) / Number(global.initialRealTokenReserves)) * 100)), "%");
  }
  return {
    price: { sol: priceSol === null ? unavailable("The curve has no tokens left.") : value(priceSol, "SOL"), usd: usd(priceSol) },
    marketCap: { sol: marketCapSol === null ? unavailable("The curve has no tokens left.") : value(marketCapSol, "SOL"), usd: usd(marketCapSol) },
    marketCapBasis,
    ...fullSupply,
    // BigInt isn't JSON: the balance goes out as a base-unit string.
    mayhem: mayhem.detected ? { ...mayhem, walletBalance: mayhem.walletBalance.toString() } : mayhem,
    liquidity: { sol: value(liquiditySol, "SOL"), usd: usd(liquiditySol) },
    curveProgress: progress,
    curveComplete: curve.complete,
  };
}

function dexMetrics(pair) {
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
  const priceUsd = num(pair.priceUsd);
  const solQuoted = pair.quoteToken?.address === WRAPPED_SOL_MINT;
  const priceSol = solQuoted ? num(pair.priceNative) : null;
  const marketCap = num(pair.marketCap ?? pair.fdv);
  const liquidityUsd = num(pair.liquidity?.usd);
  const liquiditySol = solQuoted ? num(pair.liquidity?.quote) : null;
  const orUnavailable = (v, unit, reason) => (v === null ? unavailable(reason) : value(v, unit));
  return {
    price: {
      sol: orUnavailable(priceSol, "SOL", "This DEX pair isn't quoted in SOL."),
      usd: orUnavailable(priceUsd, "USD", "DEX Screener has no USD price for this pair."),
    },
    marketCap: {
      sol: unavailable("DEX Screener reports market cap in USD."),
      usd: orUnavailable(marketCap, "USD", "DEX Screener has no market cap for this pair."),
    },
    liquidity: {
      sol: orUnavailable(liquiditySol, "SOL", "This DEX pair isn't quoted in SOL."),
      usd: orUnavailable(liquidityUsd, "USD", "DEX Screener has no liquidity for this pair."),
    },
    curveProgress: unavailable("Trading on a DEX, not a bonding curve."),
  };
}

async function lookup(mint, env, now) {
  const mintBytes = decodeAddress(mint);
  const vault = await mayhemVault();
  // The Mayhem wallet's token account for this mint, under either token
  // program; read in the same call so detection costs no extra request.
  const [curveAddress, metaplexAddress, vaultAta2022, vaultAtaSpl] = await Promise.all([
    findProgramAddress([encoder.encode("bonding-curve"), mintBytes], PUMP_PROGRAM_ID),
    findProgramAddress([encoder.encode("metadata"), decodeAddress(METADATA_PROGRAM_ID), mintBytes], METADATA_PROGRAM_ID),
    findProgramAddress([decodeAddress(vault), decodeAddress(TOKEN_2022_PROGRAM_ID), mintBytes], ASSOCIATED_TOKEN_PROGRAM_ID),
    findProgramAddress([decodeAddress(vault), decodeAddress(TOKEN_PROGRAM_ID), mintBytes], ASSOCIATED_TOKEN_PROGRAM_ID),
  ]);
  const [mintAccount, curveAccount, metaplexAccount, vault2022Account, vaultSplAccount] = await getAccounts(
    [mint, curveAddress, metaplexAddress, vaultAta2022, vaultAtaSpl],
    env,
  );
  if (!mintAccount || (mintAccount.owner !== TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID)) {
    return { status: 404, body: { code: "MINT_NOT_FOUND", error: "No token mint exists at this address." }, ttl: CACHE_TTL_MS.notFound };
  }
  const mintInfo = decodeMint(mintAccount.data);

  // Identity and logo from on-chain metadata (Metaplex, then Token-2022's own).
  let metadata = null;
  if (metaplexAccount && metaplexAccount.owner === METADATA_PROGRAM_ID) metadata = decodeMetaplexMetadata(metaplexAccount.data);
  if (!metadata && mintAccount.owner === TOKEN_2022_PROGRAM_ID) metadata = decodeToken2022Metadata(mintAccount.data);

  const curve = curveAccount && curveAccount.owner === PUMP_PROGRAM_ID ? decodeBondingCurve(curveAccount.data) : null;
  const [dex, holders] = await Promise.all([dexScreenerPair(mint), holderCount(mint, env)]);
  const logo = await tokenLogo(mint, metadata, dex.imageUrl, now);

  // While the curve is active it IS the market, read on-chain. Once it's
  // complete the token trades on a DEX, and DEX Screener is used.
  let source = null;
  let market;
  if (curve && !curve.complete) {
    source = "pump.fun bonding curve";
    const [global, solUsd] = await Promise.all([pumpGlobal(env, now).catch(() => null), solUsdPrice(env, now)]);
    const mayhem = mayhemStatus({
      curve,
      mintInfo,
      mint,
      mintProgram: mintAccount.owner,
      vault,
      vaultTokenAccount: mintAccount.owner === TOKEN_2022_PROGRAM_ID ? vault2022Account : vaultSplAccount,
    });
    market = curveMetrics(curve, mintInfo, global, solUsd, mayhem);
  } else if (dex.pair) {
    source = `DEX Screener (${String(dex.pair.dexId || "DEX")})`;
    market = dexMetrics(dex.pair);
  } else {
    const reason = curve?.complete
      ? "The bonding curve is complete; no DEX pair data is available yet."
      : dex.error
        ? `No bonding curve, and ${dex.error}.`
        : "No DEX pair and no pump.fun bonding curve for this token.";
    market = {
      price: { sol: unavailable(reason), usd: unavailable(reason) },
      marketCap: { sol: unavailable(reason), usd: unavailable(reason) },
      liquidity: { sol: unavailable(reason), usd: unavailable(reason) },
      curveProgress: unavailable(reason),
    };
  }

  return {
    status: 200,
    ttl: CACHE_TTL_MS.found,
    body: {
      mint,
      source,
      name: metadata?.name || null,
      symbol: metadata?.symbol || null,
      logo,
      decimals: mintInfo.decimals,
      supply: { value: toNumber(mintInfo.supply, mintInfo.decimals), unit: "tokens" },
      ...market,
      holders,
      fetchedAt: new Date(now).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Caching, request sharing and rate limiting

const memoryCache = new Map(); // mint -> { status, body, expires }
const inFlight = new Map(); // mint -> Promise
const ipWindows = new Map(); // ip -> [timestamps]

function remember(mint, entry) {
  if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(mint, entry);
}

async function allowRequest(ip, env, now) {
  if (env?.TOKEN_MARKET_RATE_LIMITER?.limit) {
    try {
      return (await env.TOKEN_MARKET_RATE_LIMITER.limit({ key: ip })).success;
    } catch {
      // fall through to the per-instance limit
    }
  }
  const recent = (ipWindows.get(ip) || []).filter((t) => t > now - RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.requests) {
    ipWindows.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipWindows.set(ip, recent);
  if (ipWindows.size > 10_000) ipWindows.delete(ipWindows.keys().next().value);
  return true;
}

function respond(status, body, ttlMs) {
  const cacheControl = ttlMs ? `public, max-age=${Math.floor(ttlMs / 1000)}` : "no-store, max-age=0";
  return Response.json(body, {
    status,
    headers: { "cache-control": cacheControl, "x-content-type-options": "nosniff" },
  });
}

/** For tests: forget cached lookups, prices and rate-limit windows. */
export function resetForTests() {
  memoryCache.clear();
  logoCache.clear();
  inFlight.clear();
  ipWindows.clear();
  shared.solPrice = null;
  shared.global = null;
}

export async function onRequestGet({ request, env, now = Date.now() }) {
  const mint = new URL(request.url).searchParams.get("mint") || "";
  // Validated before anything touches the network.
  if (!decodeAddress(mint)) {
    return respond(400, { code: "INVALID_MINT", error: "mint must be a Solana address." }, 0);
  }

  const cached = memoryCache.get(mint);
  if (cached && cached.expires > now) return respond(cached.status, cached.body, cached.expires - now);

  const edgeCache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://token-market.cache/${mint}`);
  if (edgeCache) {
    const hit = await edgeCache.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }

  // Only lookups that will reach upstream services count against the limit.
  if (!inFlight.has(mint)) {
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    if (!(await allowRequest(ip, env, now))) {
      return new Response(JSON.stringify({ code: "RATE_LIMITED", error: "Too many token lookups; try again in a minute." }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(RATE_LIMIT.windowMs / 1000), "cache-control": "no-store" },
      });
    }
  }

  let pending = inFlight.get(mint);
  if (!pending) {
    pending = lookup(mint, env, now)
      .catch(() => ({ status: 502, body: { code: "UPSTREAM_ERROR", error: "Solana data is temporarily unavailable." }, ttl: CACHE_TTL_MS.error }))
      .finally(() => inFlight.delete(mint));
    inFlight.set(mint, pending);
  }
  const result = await pending;
  remember(mint, { status: result.status, body: result.body, expires: now + result.ttl });
  const response = respond(result.status, result.body, result.ttl);
  if (edgeCache) await edgeCache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}
