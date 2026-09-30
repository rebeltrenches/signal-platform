// GET /api/xray?mint=<Solana mint> — Signal X-Ray: on-chain facts about
// any Solana token (not only Signal launches). Read-only: nothing is ever
// signed or sent; the sell check is a simulateTransaction.
//
// Every item is a fact with a status ("ok" ✅, "warn" ⚠️, "info", or
// "unavailable") and a one-line "why it matters". There is deliberately no
// overall verdict or score: never "safe", "not a honeypot" or "rug-free".
// Anything that can't be read is reported as Unavailable, never guessed.
//
// Keys stay server-side: SOLANA_RPC_URL (Helius) for chain reads, with the
// public RPCs as fallback, and JUPITER_API_KEY for the sell route. Results
// are cached per mint for a few minutes, and uncached lookups are
// rate-limited per IP (XRAY_RATE_LIMITER binding, else per instance).
// Each response reports the upstream calls it made (`usage`).
import { decodeAddress, encodeAddress, findProgramAddress, isMintAccount, decodeBondingCurve, decodeTokenAccount } from "./token-market.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CPMM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";

const FALLBACK_RPC_URLS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const UPSTREAM_TIMEOUT_MS = 8_000;
const SIGNAL_API_TIMEOUT_MS = 4_000;

export const CACHE_TTL_MS = { full: 5 * 60_000, partial: 60_000, error: 30_000 };
export const RATE_LIMIT = { requests: 10, windowMs: 60_000 };
const MAX_MEMORY_CACHE_ENTRIES = 1_000;
/** Recent pool/curve transactions read for the sell history. Busy pools
 *  carry many failed bot transactions, so more signatures are listed than
 *  read; reads go in small chunks (rate limits) with one retry. */
export const RECENT_TRANSACTIONS = 15;
export const MIN_TRANSACTIONS_FOR_SELLS = 5;
const SIGNATURES_PER_POOL = 60;
const MAX_POOLS_FOR_SELLS = 3;
const TRANSACTION_CHUNK = 5;
/** PumpSwap pools record every LP token ever issued (lp_supply, checked
 *  on mainnet), so LP burned with an SPL burn can be counted. */
const PUMPSWAP_LP_SUPPLY_OFFSET = 203;
/** A wallet share of all LP below this is shown as ✅ (it can only
 *  withdraw that small share of the liquidity). */
const LP_WALLET_WARN_PERCENT = 5;
/** A holder needs this much SOL to pay the simulated sell's fees. */
const SIMULATION_MIN_LAMPORTS = 5_000_000n;
/** Marker thresholds (facts, not scores): shown as ⚠️ past these. */
export const THRESHOLDS = { top10Percent: 25, liquidityUsd: 10_000, poolAgeHours: 24 };

/** Programs whose accounts are pools or curves, not holders. */
export const POOL_PROGRAMS = {
  [PUMP_PROGRAM_ID]: "pump.fun bonding curve",
  [PUMPSWAP_PROGRAM_ID]: "PumpSwap pool",
  [RAYDIUM_AMM_V4]: "Raydium AMM pool",
  [RAYDIUM_CPMM]: "Raydium CPMM pool",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM pool",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "Raydium LaunchLab curve",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM pool",
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: "Meteora pool",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2 pool",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora bonding curve",
};
/** Pool authorities that hold vaults without being program-owned accounts. */
const KNOWN_POOL_AUTHORITIES = {
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium AMM pool",
  GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL: "Raydium CPMM pool",
};
/** Where each supported pool keeps its LP mint (checked on mainnet). */
export const LP_MINT_OFFSETS = { [PUMPSWAP_PROGRAM_ID]: 107, [RAYDIUM_AMM_V4]: 464, [RAYDIUM_CPMM]: 136 };
const NO_LP_TOKEN_PROGRAMS = new Set([
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
]);
/** pump.fun curve: creator at 49; PumpSwap pool: coin creator at 211. */
const CURVE_CREATOR_OFFSET = 49;
const PUMPSWAP_COIN_CREATOR_OFFSET = 211;

// Token-2022 extension types (spl-token-2022 ExtensionType).
const EXT = { transferFee: 1, mintClose: 3, defaultState: 6, nonTransferable: 9, permanentDelegate: 12, transferHook: 14, metadataPointer: 18, tokenMetadata: 19, pausable: 26 };

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Decoding (pure; exported for tests)

function u64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}
function u16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}
/** A 32-byte key, or null when it is all zeros (OptionalNonZeroPubkey). */
function nonZeroKey(bytes, offset) {
  const key = bytes.subarray(offset, offset + 32);
  return key.length === 32 && key.some((b) => b !== 0) ? encodeAddress(key) : null;
}
function readString(bytes, offset) {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  if (offset + 4 + length > bytes.length) throw new Error("truncated string");
  return { value: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + length)).replace(/\u0000+$/, "").trim(), next: offset + 4 + length };
}

/** A mint account: authorities, supply, decimals and Token-2022 extensions. */
export function parseMint(owner, bytes) {
  if (!bytes || !isMintAccount(owner, bytes)) return null;
  const optionKey = (offset) => (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true) === 1 ? encodeAddress(bytes.subarray(offset + 4, offset + 36)) : null);
  const mint = {
    programId: owner,
    program: owner === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL Token",
    mintAuthority: optionKey(0),
    supply: u64(bytes, 36),
    decimals: bytes[44],
    freezeAuthority: optionKey(46),
    extensions: {},
  };
  if (bytes.length <= 166) return mint;
  let offset = 166;
  while (offset + 4 <= bytes.length) {
    const type = u16(bytes, offset);
    const length = u16(bytes, offset + 2);
    const start = offset + 4;
    if (type === 0 && length === 0) break;
    if (start + length > bytes.length) break;
    const ext = mint.extensions;
    if (type === EXT.transferFee && length >= 108) {
      ext.transferFee = {
        authority: nonZeroKey(bytes, start),
        older: { epoch: u64(bytes, start + 72), maximumFee: u64(bytes, start + 80), basisPoints: u16(bytes, start + 88) },
        newer: { epoch: u64(bytes, start + 90), maximumFee: u64(bytes, start + 98), basisPoints: u16(bytes, start + 106) },
      };
    } else if (type === EXT.mintClose && length >= 32) ext.mintCloseAuthority = nonZeroKey(bytes, start);
    else if (type === EXT.defaultState && length >= 1) ext.defaultState = bytes[start] === 2 ? "frozen" : bytes[start] === 1 ? "initialized" : "uninitialized";
    else if (type === EXT.nonTransferable) ext.nonTransferable = true;
    else if (type === EXT.permanentDelegate && length >= 32) ext.permanentDelegate = nonZeroKey(bytes, start);
    else if (type === EXT.transferHook && length >= 64) ext.transferHook = { authority: nonZeroKey(bytes, start), programId: nonZeroKey(bytes, start + 32) };
    else if (type === EXT.metadataPointer && length >= 64) ext.metadataPointer = { authority: nonZeroKey(bytes, start), address: nonZeroKey(bytes, start + 32) };
    else if (type === EXT.tokenMetadata && length >= 64) {
      try {
        const name = readString(bytes, start + 64);
        const symbol = readString(bytes, name.next);
        ext.tokenMetadata = { updateAuthority: nonZeroKey(bytes, start), name: name.value, symbol: symbol.value };
      } catch {
        ext.tokenMetadata = { updateAuthority: nonZeroKey(bytes, start) };
      }
    } else if (type === EXT.pausable && length >= 33) ext.pausable = { authority: nonZeroKey(bytes, start), paused: bytes[start + 32] === 1 };
    offset = start + length;
  }
  return mint;
}

/** Metaplex metadata: name, symbol, update authority and isMutable. */
export function parseMetaplexMetadata(bytes) {
  if (!bytes || bytes[0] !== 4 || bytes.length < 66) return null;
  try {
    const name = readString(bytes, 65);
    const symbol = readString(bytes, name.next);
    const uri = readString(bytes, symbol.next);
    let cursor = uri.next + 2; // seller fee basis points
    if (bytes[cursor] === 1) {
      const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(cursor + 1, true);
      cursor += 1 + 4 + count * 34;
    } else {
      cursor += 1;
    }
    cursor += 1; // primary sale happened
    if (cursor >= bytes.length) return null;
    return { name: name.value, symbol: symbol.value, updateAuthority: encodeAddress(bytes.subarray(1, 33)), isMutable: bytes[cursor] === 1 };
  } catch {
    return null;
  }
}

/** amount / total as a percentage with two decimals (e.g. 24.5). */
export function percentOf(amount, total) {
  if (!total || total <= 0n) return null;
  return Number((amount * 10_000n) / total) / 100;
}
function formatUnits(amount, decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = decimals ? (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction.slice(0, 4)}` : ""}`;
}
const short = (address) => (address && address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);
const item = (id, label, value, status, why, extra = {}) => ({ id, label, value, status, why, ...extra });
const unavailable = (id, label, why, reason) => item(id, label, "Unavailable", "unavailable", why, reason ? { reason } : {});

// ---------------------------------------------------------------------------
// Upstream calls, counted per X-Ray

function rpcUrls(env) {
  const configured = typeof env?.SOLANA_RPC_URL === "string" ? env.SOLANA_RPC_URL.trim() : "";
  return [...new Set([...(configured.startsWith("https://") ? [configured] : []), ...FALLBACK_RPC_URLS])];
}

function newUsage() {
  return { rpcCalls: 0, rpcByMethod: {}, jupiterRequests: 0, dexScreenerRequests: 0, signalApiRequests: 0 };
}

function createRpc(env, usage) {
  const urls = rpcUrls(env);
  const count = (method) => {
    usage.rpcCalls += 1;
    usage.rpcByMethod[method] = (usage.rpcByMethod[method] || 0) + 1;
  };
  /** POST to the configured RPC, then the public ones; `accept` decides
   *  whether an answer is usable (an RPC error moves on to the next URL). */
  async function post(payload, accept) {
    let lastError = new Error("RPC unavailable");
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const body = await response.json();
        if (!accept(body)) throw new Error(`RPC error ${body?.error?.code ?? ""}`.trim());
        return body;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  const rpc = {
    async call(method, params) {
      count(method);
      const body = await post({ jsonrpc: "2.0", id: 1, method, params }, (answer) => answer && !answer.error && "result" in answer);
      return body.result;
    },
    /** Several calls in one HTTP request (each still counts as a call). */
    async batch(calls) {
      if (!calls.length) return [];
      for (const [method] of calls) count(method);
      const body = await post(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params })), (answer) => Array.isArray(answer) && answer.some((entry) => entry && !entry.error));
      const byId = new Map(body.map((entry) => [entry.id, entry]));
      return calls.map((_, id) => (byId.get(id)?.error ? null : byId.get(id)?.result ?? null));
    },
    async accounts(addresses) {
      const result = await rpc.call("getMultipleAccounts", [addresses, { encoding: "base64", commitment: "confirmed" }]);
      if (!Array.isArray(result?.value) || result.value.length !== addresses.length) throw new Error("RPC response");
      return result.value.map((account) => account && {
        owner: account.owner,
        lamports: BigInt(account.lamports ?? 0),
        data: Uint8Array.from(atob(account.data?.[0] ?? ""), (c) => c.charCodeAt(0)),
      });
    },
  };
  return rpc;
}

async function dexScreenerPairs(mint, usage) {
  usage.dexScreenerRequests += 1;
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`DEX Screener HTTP ${response.status}`);
  const pairs = await response.json();
  const own = (Array.isArray(pairs) ? pairs : []).filter((pair) => pair?.baseToken?.address === mint || pair?.quoteToken?.address === mint);
  const dexPairs = own.filter((pair) => String(pair?.dexId) !== "pumpfun");
  dexPairs.sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
  return dexPairs[0] || null;
}

/** { registered, creator } from Signal's registry, or null if unreachable. */
async function signalRecord(mint, env, usage) {
  const origin = typeof env?.SIGNAL_API_ORIGIN === "string" ? env.SIGNAL_API_ORIGIN.trim().replace(/\/$/, "") : "";
  if (!origin.startsWith("https://")) return null;
  usage.signalApiRequests += 1;
  try {
    const response = await fetch(`${origin}/api/v1/tokens/solana/${mint}`, { signal: AbortSignal.timeout(SIGNAL_API_TIMEOUT_MS) });
    if (response.status === 404) return { registered: false };
    if (!response.ok) return null;
    const body = await response.json();
    return body?.token ? { registered: true, creator: body.token.creatorWalletAddress || null } : { registered: false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The checks

function factItems(mint, metadata, signal) {
  const items = [];
  // Signal's registry holds tokens launched on Signal and tokens listed
  // afterwards ("List an existing token"), with no record of which, so this
  // says "registered", never "launched on Signal".
  if (signal?.registered) {
    items.push(mint.mintAuthority
      ? item("signal-registered", "Registered on Signal", "Yes", "info", "This token is listed on Signal.")
      : item("signal-registered", "Registered on Signal", "Yes (mint authority revoked)", "ok", "Signal only lists tokens whose mint authority is revoked, so the supply can't grow."));
  } else if (signal === null) {
    items.push(unavailable("signal-registered", "Registered on Signal", "Signal's token records couldn't be reached right now."));
  }
  items.push(mint.mintAuthority
    ? item("mint-authority", "Mint authority", `Active (${short(mint.mintAuthority)})`, "warn", "Whoever holds this key can mint more tokens at any time, diluting every holder.")
    : item("mint-authority", "Mint authority", "Revoked", "ok", "No one can ever mint more of this token."));
  items.push(mint.freezeAuthority
    ? item("freeze-authority", "Freeze authority", `Active (${short(mint.freezeAuthority)})`, "warn", "Whoever holds this key can freeze any holder's tokens so they can't be sold or moved.")
    : item("freeze-authority", "Freeze authority", "Revoked", "ok", "No one can freeze holders' token accounts."));

  const t22 = mint.extensions.tokenMetadata;
  if (t22 && !metadata) {
    items.push(t22.updateAuthority
      ? item("metadata", "Metadata", `Mutable (update authority ${short(t22.updateAuthority)})`, "warn", "The update authority can change the name, symbol or image later.")
      : item("metadata", "Metadata", "Immutable", "ok", "The name, symbol and image can't be changed."));
  } else if (metadata) {
    items.push(metadata.isMutable
      ? item("metadata", "Metadata", `Mutable (update authority ${short(metadata.updateAuthority)})`, "warn", "The update authority can change the name, symbol or image later.")
      : item("metadata", "Metadata", "Immutable", "ok", "The name, symbol and image can't be changed."));
  } else {
    items.push(item("metadata", "Metadata", "No on-chain metadata found", "info", "Without metadata, wallets can't show a verified name or image for this token."));
  }
  items.push(item("supply", "Supply", `${formatUnits(mint.supply, mint.decimals)} tokens (${mint.decimals} decimals)`, "info", "The total number of tokens that exist right now."));
  items.push(item("program", "Token program", mint.program, "info", mint.program === "Token-2022"
    ? "Token-2022 tokens can carry extensions that change how transfers work; each is checked below."
    : "Standard SPL tokens can't carry transfer fees, hooks, permanent delegates or pausing."));
  if (mint.program === "Token-2022") items.push(...extensionItems(mint));
  return items;
}

/** The transfer fee in force now, and any scheduled change. Token-2022
 *  keeps the active ("older") fee and a "newer" one that takes over at its
 *  epoch; `now` is null when the current epoch couldn't be read. */
export function transferFeeSchedule(fee, currentEpoch) {
  if (!fee) return null;
  const older = fee.older.basisPoints;
  const newer = fee.newer.basisPoints;
  if (older === newer) return { now: newer, next: null, epoch: null };
  if (currentEpoch === null || currentEpoch === undefined) return { now: null, older, next: newer, epoch: fee.newer.epoch };
  return currentEpoch >= fee.newer.epoch ? { now: newer, next: null, epoch: null } : { now: older, next: newer, epoch: fee.newer.epoch };
}

function transferFeeItem(fee, currentEpoch) {
  if (!fee) return item("transfer-fee", "Transfer fee", "None", "ok", "Transfers and sells aren't taxed by the token itself.");
  const schedule = transferFeeSchedule(fee, currentEpoch);
  const authority = fee.authority ? `; fee authority ${short(fee.authority)} can change it` : "";
  if (schedule.now === null) {
    return item("transfer-fee", "Transfer fee", `${schedule.older / 100}% or ${schedule.next / 100}% (${schedule.next / 100}% from epoch ${schedule.epoch}; the current epoch couldn't be read)${authority}`, "warn", `Every transfer, including a sell, loses up to ${Math.max(schedule.older, schedule.next) / 100}% of the tokens to the fee.`);
  }
  const scheduled = schedule.next !== null ? `, changing to ${schedule.next / 100}% at epoch ${schedule.epoch}` : "";
  if (schedule.now > 0) {
    return item("transfer-fee", "Transfer fee", `${schedule.now / 100}% now${scheduled}${authority}`, "warn", `Every transfer, including a sell, loses ${schedule.now / 100}% of the tokens to the fee${fee.authority ? ", and the fee can be raised" : ""}.`);
  }
  if (schedule.next > 0) {
    return item("transfer-fee", "Transfer fee", `0% now${scheduled}${authority}`, "warn", `There's no fee today, but a ${schedule.next / 100}% fee on every transfer, including sells, starts at epoch ${schedule.epoch}.`);
  }
  return fee.authority
    ? item("transfer-fee", "Transfer fee", `0% now${authority}`, "warn", "There's no fee today, but the fee authority can add one to every transfer, including sells.")
    : item("transfer-fee", "Transfer fee", "0%", "ok", "The fee is set to zero and no one can change it.");
}

function extensionItems(mint) {
  const ext = mint.extensions;
  const items = [transferFeeItem(ext.transferFee, mint.currentEpoch)];
  items.push(ext.transferHook?.programId
    ? item("transfer-hook", "Transfer hook", `Program ${short(ext.transferHook.programId)}`, "warn", "Every transfer runs this program, which can block transfers such as sells.")
    : item("transfer-hook", "Transfer hook", "None", "ok", "No extra program runs on transfers."));
  items.push(ext.permanentDelegate
    ? item("permanent-delegate", "Permanent delegate", short(ext.permanentDelegate), "warn", "This key can move or burn tokens from any holder's account without their approval.")
    : item("permanent-delegate", "Permanent delegate", "None", "ok", "No key can move tokens out of holders' accounts."));
  items.push(ext.defaultState === "frozen"
    ? item("default-frozen", "New accounts start frozen", "Yes", "warn", "Buyers' token accounts start frozen; they can't sell until the issuer thaws them.")
    : item("default-frozen", "New accounts start frozen", "No", "ok", "New holders can move their tokens right away."));
  if (!ext.pausable) items.push(item("pausable", "Pausable", "No", "ok", "No one can pause all transfers."));
  else if (ext.pausable.paused) items.push(item("pausable", "Pausable", "Paused right now", "warn", "All transfers, including sells, are stopped right now."));
  else items.push(item("pausable", "Pausable", `Yes (pause authority ${short(ext.pausable.authority) || "none"})`, ext.pausable.authority ? "warn" : "ok", ext.pausable.authority ? "The pause authority can stop all transfers, including sells, at any time." : "The pause extension has no authority, so it can't be used."));
  items.push(ext.nonTransferable
    ? item("non-transferable", "Non-transferable", "Yes", "warn", "These tokens can't be transferred or sold at all.")
    : item("non-transferable", "Non-transferable", "No", "ok", "Tokens can be transferred normally."));
  return items;
}

/** The honeypot mechanisms found among the facts above. */
function mechanisms(mint) {
  const ext = mint.extensions;
  const found = [];
  if (mint.freezeAuthority) found.push("freeze authority");
  if (ext.defaultState === "frozen") found.push("new accounts start frozen");
  if (ext.transferHook?.programId) found.push("transfer hook");
  if (ext.permanentDelegate) found.push("permanent delegate");
  if (ext.pausable?.paused) found.push("transfers paused");
  else if (ext.pausable?.authority) found.push("pausable");
  if (ext.nonTransferable) found.push("non-transferable");
  const schedule = transferFeeSchedule(ext.transferFee, mint.currentEpoch);
  if (schedule) {
    if (schedule.now === null) found.push(`transfer fee (up to ${Math.max(schedule.older, schedule.next) / 100}%)`);
    else if (schedule.now > 0) found.push(`transfer fee (${schedule.now / 100}%)`);
    if (schedule.now !== null && schedule.next > 0) found.push(`transfer fee scheduled (${schedule.next / 100}% from epoch ${schedule.epoch})`);
    if (schedule.now === 0 && !schedule.next && ext.transferFee.authority) found.push("transfer fee authority (0% now)");
  }
  return found;
}

function labelHolders(holderRows, ownerAccounts, context) {
  return holderRows.map((row, index) => {
    const ownerAccount = ownerAccounts[index];
    let label = null;
    let excluded = false;
    if (row.owner === INCINERATOR) label = "burn address";
    else if (row.owner === context.curve) { label = "pump.fun bonding curve"; excluded = true; }
    else if (row.owner === context.pool) { label = context.poolLabel || "liquidity pool"; excluded = true; }
    else if (KNOWN_POOL_AUTHORITIES[row.owner]) { label = KNOWN_POOL_AUTHORITIES[row.owner]; excluded = true; }
    else if (ownerAccount && POOL_PROGRAMS[ownerAccount.owner]) { label = POOL_PROGRAMS[ownerAccount.owner]; excluded = true; }
    else if (ownerAccount && ownerAccount.owner !== SYSTEM_PROGRAM_ID) label = `program account (${short(ownerAccount.owner)})`;
    if (row.owner === context.creator) label = label ? `${label}, creator` : "creator";
    return { ...row, label, excluded };
  });
}

async function sellSimulation({ mint, holders, ownerAccounts, env, rpc, usage }) {
  const why = "A small sell from a real holder was simulated just now (nothing was sent). Conditions can change at any time.";
  const apiKey = typeof env?.JUPITER_API_KEY === "string" ? env.JUPITER_API_KEY.trim() : "";
  if (!apiKey) return unavailable("sell-simulation", "Sell simulation", why, "Sell routing isn't configured on this server.");
  let candidate = null;
  for (let index = 0; index < holders.length && !candidate; index += 1) {
    const holder = holders[index];
    const ownerAccount = ownerAccounts[index];
    if (holder.excluded || !ownerAccount || ownerAccount.owner !== SYSTEM_PROGRAM_ID || ownerAccount.lamports < SIMULATION_MIN_LAMPORTS || holder.amount <= 0n) continue;
    // The router spends from the holder's associated token account.
    const ata = await findProgramAddress([decodeAddress(holder.owner), decodeAddress(mint.programId), decodeAddress(mint.address)], ASSOCIATED_TOKEN_PROGRAM_ID);
    if (ata === holder.tokenAccount) candidate = holder;
  }
  if (!candidate) return unavailable("sell-simulation", "Sell simulation", why, "No suitable holder to simulate with (one holding the token in a normal wallet with SOL for fees).");
  const amount = candidate.amount / 100n > 0n ? candidate.amount / 100n : candidate.amount;
  usage.jupiterRequests += 1;
  let order;
  try {
    const params = new URLSearchParams({ inputMint: mint.address, outputMint: WRAPPED_SOL_MINT, amount: amount.toString(), taker: candidate.owner });
    const response = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
    order = response.ok ? await response.json() : null;
  } catch {
    order = null;
  }
  if (!order?.transaction) return unavailable("sell-simulation", "Sell simulation", why, "No sell route was available to simulate right now.");
  let simulation;
  try {
    simulation = await rpc.call("simulateTransaction", [order.transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  } catch {
    return unavailable("sell-simulation", "Sell simulation", why, "The simulation couldn't be run right now.");
  }
  const err = simulation?.value?.err;
  const holderText = `a holder (${short(candidate.owner)}) selling ${formatUnits(amount, mint.decimals)} tokens`;
  if (!err) return item("sell-simulation", "Sell simulation", `Succeeded right now for ${holderText}`, "ok", why);
  const logs = (simulation?.value?.logs || []).join("\n");
  const reason = /insufficient lamports|insufficient funds for fee/i.test(logs) ? null
    : /frozen/i.test(logs) || JSON.stringify(err).includes('"Custom":17') ? "a token account is frozen"
      : /pause/i.test(logs) ? "transfers are paused"
        : /hook/i.test(logs) ? "the transfer hook rejected it"
          : "the transaction failed";
  if (!reason) return unavailable("sell-simulation", "Sell simulation", why, "The simulated holder couldn't pay the network fees.");
  return item("sell-simulation", "Sell simulation", `Failed right now for ${holderText}: ${reason}`, "warn", "A real holder's small sell failed in a simulation just now (nothing was sent).");
}

/** Whether `owner` received SOL (native, net of the fee it paid) or one of
 *  `counterMints` (WSOL, the main pair's other token, and whatever a pool
 *  paid out in this transaction, e.g. USDC from a secondary pool). */
function receivedCounterValue(tx, owner, counterMints) {
  const message = tx.transaction?.message || {};
  const keys = [...(message.accountKeys || []).map((entry) => (typeof entry === "string" ? entry : entry?.pubkey)), ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])];
  const index = keys.indexOf(owner);
  if (index >= 0 && Array.isArray(tx.meta?.preBalances) && Array.isArray(tx.meta?.postBalances)) {
    const fee = index === 0 ? Number(tx.meta.fee || 0) : 0;
    if (Number(tx.meta.postBalances[index]) + fee - Number(tx.meta.preBalances[index]) > 0) return true;
  }
  let delta = 0n;
  for (const [balances, sign] of [[tx.meta?.preTokenBalances, -1n], [tx.meta?.postTokenBalances, 1n]]) {
    for (const balance of balances || []) {
      if (balance.owner === owner && counterMints.has(balance.mint)) delta += sign * BigInt(balance.uiTokenAmount?.amount || "0");
    }
  }
  return delta > 0n;
}

/** The latest successful transactions across `pools`, newest first, and
 *  how many pools' transaction lists couldn't be read. */
async function recentPoolSignatures(pools, rpc) {
  const lists = await Promise.all(pools.map((pool) => rpc.call("getSignaturesForAddress", [pool, { limit: SIGNATURES_PER_POOL, commitment: "confirmed" }]).then((list) => (Array.isArray(list) ? list : null), () => null)));
  const seen = new Set();
  const signatures = lists.filter(Boolean).flat()
    .filter((entry) => entry && !entry.err && !seen.has(entry.signature) && seen.add(entry.signature))
    .sort((a, b) => (Number(b.blockTime) || 0) - (Number(a.blockTime) || 0))
    .slice(0, RECENT_TRANSACTIONS)
    .map((entry) => entry.signature);
  return { signatures, failedPools: lists.filter((list) => list === null).length };
}

/** getTransaction for each signature, in small batches, retrying misses once. */
async function readTransactions(signatures, rpc) {
  const params = (signature) => ["getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]];
  const found = new Map();
  for (const attempt of [0, 1]) {
    const missing = signatures.filter((signature) => !found.has(signature));
    if (!missing.length) break;
    for (let index = 0; index < missing.length; index += TRANSACTION_CHUNK) {
      const chunk = missing.slice(index, index + TRANSACTION_CHUNK);
      const results = await rpc.batch(chunk.map(params)).catch(() => []);
      chunk.forEach((signature, position) => {
        if (results[position]) found.set(signature, results[position]);
      });
    }
    if (attempt === 0 && found.size === signatures.length) break;
  }
  return signatures.map((signature) => found.get(signature)).filter(Boolean);
}

async function recentSells({ mint, pools, excludedOwners, creator, counterMints, rpc }) {
  const why = "Recent successful sells (the wallet's tokens went out and SOL or the pool's other token came in) show that selling has worked lately.";
  if (!pools.length) return unavailable("recent-sells", "Recent sells", why, "No pool or bonding curve found to read transactions from.");
  let read;
  let wanted = 0;
  let failedPools = 0;
  try {
    const listed = await recentPoolSignatures(pools, rpc);
    failedPools = listed.failedPools;
    wanted = listed.signatures.length;
    read = await readTransactions(listed.signatures, rpc);
  } catch {
    return unavailable("recent-sells", "Recent sells", why);
  }
  const readPools = pools.length - failedPools;
  if (read.length < MIN_TRANSACTIONS_FOR_SELLS) {
    return item("recent-sells", "Recent sells", "Not enough recent data", "unavailable", why, { reason: `Only ${read.length} of ${wanted || RECENT_TRANSACTIONS} recent pool transactions could be read right now.` });
  }
  let sells = 0;
  const sellers = new Set();
  for (const tx of read) {
    if (tx.meta?.err) continue;
    const deltas = new Map();
    const poolDeltas = new Map(); // `${pool} ${mint}` -> change, for pools' other tokens
    for (const [balances, sign] of [[tx.meta?.preTokenBalances, -1n], [tx.meta?.postTokenBalances, 1n]]) {
      for (const balance of balances || []) {
        if (!balance.owner) continue;
        const amount = sign * BigInt(balance.uiTokenAmount?.amount || "0");
        if (balance.mint === mint) deltas.set(balance.owner, (deltas.get(balance.owner) || 0n) + amount);
        else if (excludedOwners.has(balance.owner)) poolDeltas.set(`${balance.owner} ${balance.mint}`, (poolDeltas.get(`${balance.owner} ${balance.mint}`) || 0n) + amount);
      }
    }
    // In a swap a pool pays out its other token; in a deposit it only
    // receives (and LP tokens are minted, not paid by the pool).
    const proceeds = new Set(counterMints);
    for (const [key, change] of poolDeltas) if (change < 0n) proceeds.add(key.split(" ")[1]);
    let sold = false;
    for (const [owner, delta] of deltas) {
      if (delta < 0n && !excludedOwners.has(owner) && owner !== creator && receivedCounterValue(tx, owner, proceeds)) {
        sold = true;
        sellers.add(owner);
      }
    }
    if (sold) sells += 1;
  }
  const scope = `in the last ${read.length} transactions across ${readPools} pool${readPools === 1 ? "" : "s"}${failedPools ? ` (${failedPools} more pool${failedPools === 1 ? "" : "s"} couldn't be read)` : ""}`;
  const creatorNote = creator ? "" : " (creator wallet not identified, so all sellers are counted)";
  if (sells > 0) return item("recent-sells", "Recent sells", `${sells} successful sell${sells === 1 ? "" : "s"} by ${sellers.size} non-creator wallet${sellers.size === 1 ? "" : "s"} ${scope}${creatorNote}`, "ok", why);
  // "No sells" is only claimed when every pool was read.
  if (failedPools) {
    return item("recent-sells", "Recent sells", "Not enough recent data", "unavailable", why, { reason: `No sells in the ${read.length} transactions read, but ${failedPools} of ${pools.length} pools couldn't be read.` });
  }
  return item("recent-sells", "Recent sells", `No successful sells by non-creator wallets ${scope}${creatorNote}`, "warn", "No other wallet has sold successfully in the recent transactions read.");
}

async function lpStatus({ poolAccount, rpc }) {
  const why = "LP tokens are the claim on the pool's liquidity: while a wallet holds them, it can withdraw that liquidity.";
  if (!poolAccount) return unavailable("lp", "LP tokens", why, "The pool account couldn't be read.");
  if (NO_LP_TOKEN_PROGRAMS.has(poolAccount.owner)) return item("lp", "LP tokens", "Not applicable: this pool type uses positions, not LP tokens", "info", "Concentrated-liquidity positions can be withdrawn by whoever owns them.");
  const offset = LP_MINT_OFFSETS[poolAccount.owner];
  if (offset === undefined || poolAccount.data.length < offset + 32) return unavailable("lp", "LP tokens", why, "This pool type isn't supported yet.");
  const lpMint = encodeAddress(poolAccount.data.subarray(offset, offset + 32));
  // All LP ever issued, when the pool records it (PumpSwap); burning LP
  // lowers the mint's supply but not this.
  const issuedField = poolAccount.owner === PUMPSWAP_PROGRAM_ID && poolAccount.data.length >= PUMPSWAP_LP_SUPPLY_OFFSET + 8 ? u64(poolAccount.data, PUMPSWAP_LP_SUPPLY_OFFSET) : null;
  try {
    const [supplyResult, largest] = await Promise.all([rpc.call("getTokenSupply", [lpMint, { commitment: "confirmed" }]), rpc.call("getTokenLargestAccounts", [lpMint, { commitment: "confirmed" }])]);
    const supply = BigInt(supplyResult?.value?.amount ?? "0");
    if (supply === 0n) return item("lp", "LP tokens", "100% burned", "ok", "Burned LP tokens can't be redeemed, so this liquidity can't be withdrawn.");
    const issued = issuedField !== null && issuedField >= supply ? issuedField : null;
    const base = issued ?? supply;
    const burnedBySupply = issued !== null ? issued - supply : 0n;
    const top = largest?.value || []; // up to 20 accounts
    const accounts = top.length ? await rpc.accounts(top.map((entry) => entry.address)) : [];
    const holders = accounts.map((account, index) => ({ owner: account?.data?.length >= 72 ? decodeTokenAccount(account.data)?.owner : null, amount: BigInt(top[index].amount) }));
    const ownerAccounts = holders.some((h) => h.owner) ? await rpc.accounts(holders.map((h) => h.owner || SYSTEM_PROGRAM_ID)) : [];
    let burned = 0n;
    let program = 0n;
    let wallet = 0n;
    let biggestWallet = null;
    holders.forEach((holder, index) => {
      if (holder.owner === INCINERATOR) burned += holder.amount;
      else if (ownerAccounts[index] && ownerAccounts[index].owner !== SYSTEM_PROGRAM_ID) program += holder.amount;
      else {
        wallet += holder.amount;
        if (!biggestWallet || holder.amount > biggestWallet.amount) biggestWallet = holder;
      }
    });
    // LP in accounts beyond the listed ones can't be classified: it's
    // counted as possibly wallet-held when deciding the marker.
    const listed = holders.reduce((sum, holder) => sum + holder.amount, 0n);
    const unlisted = supply > listed ? supply - listed : 0n;
    const allBurned = burned + burnedBySupply;
    const of = issued !== null ? "" : " of the LP tokens that still exist";
    const burnedText = allBurned > 0n ? `${percentOf(allBurned, base)}% burned; ` : "";
    const unlistedPercent = percentOf(unlisted, base);
    const unlistedText = unlisted > 0n ? `; ${unlistedPercent >= 0.01 ? unlistedPercent : "<0.01"}% in smaller holdings not checked` : "";
    if (wallet > 0n || unlisted > 0n) {
      const walletPercent = percentOf(wallet, base);
      const small = issued !== null && percentOf(wallet + unlisted, base) < LP_WALLET_WARN_PERCENT;
      const largestText = biggestWallet ? ` (largest ${short(biggestWallet.owner)})` : "";
      return item("lp", "LP tokens", `${burnedText}${walletPercent}% held by wallets${of}${largestText}${unlistedText}`, small ? "ok" : "warn", small
        ? "Almost all LP tokens are burned; the wallets holding the rest can only withdraw their small share of the liquidity."
        : `A wallet holding LP tokens can withdraw that share of the liquidity at any time${issued === null ? " (LP burned earlier can't be counted for this pool type)" : ""}.`);
    }
    if (program === 0n) return item("lp", "LP tokens", `${percentOf(allBurned, base)}% burned`, "ok", "Burned LP tokens can't be redeemed, so this liquidity can't be withdrawn.");
    return item("lp", "LP tokens", `${burnedText}${percentOf(program, base)}% held by programs${of} (e.g. a locker or the pool)`, "info", "LP held by a program is only as locked as that program's rules; check the lock's terms and end date.");
  } catch {
    return unavailable("lp", "LP tokens", why);
  }
}

function marketItems({ curve, pair, poolAccount, now }) {
  const items = [];
  const onCurve = curve && !curve.complete;
  if (onCurve) {
    items.push(item("market", "Market", "On the pump.fun bonding curve (not graduated)", "info", "Until graduation, the price is set by the curve and all liquidity sits in it."));
    items.push(item("liquidity", "Liquidity", `${formatUnits(curve.realSolReserves, 9)} SOL in the bonding curve`, curve.realSolReserves < 5_000_000_000n ? "warn" : "ok", "Little SOL in the curve means sells move the price a lot."));
    items.push(item("pool-age", "Pool age", "Not applicable (still on the bonding curve)", "info", "A pool is created when the token graduates."));
    return items;
  }
  if (!pair) {
    items.push(unavailable("market", "Market", "Where this token trades and how much liquidity backs it.", "No trading pool was found."));
    items.push(unavailable("liquidity", "Liquidity", "How much can be sold before the price collapses."));
    items.push(unavailable("pool-age", "Pool age", "How long the pool has existed."));
    return items;
  }
  const venue = (poolAccount && POOL_PROGRAMS[poolAccount.owner]) || `${pair.dexId}${pair.labels?.length ? ` ${pair.labels.join(" ")}` : ""}`;
  items.push(item("market", "Market", `${curve?.complete ? "Graduated from pump.fun; trading on " : "Trading on "}${venue}`, "info", "Where most of this token's liquidity is."));
  const usd = Number(pair.liquidity?.usd);
  items.push(Number.isFinite(usd)
    ? item("liquidity", "Liquidity", `$${Math.round(usd).toLocaleString("en-US")} (DEX Screener)`, usd < THRESHOLDS.liquidityUsd ? "warn" : "ok", "Thin liquidity means small sells move the price a lot.")
    : unavailable("liquidity", "Liquidity", "How much can be sold before the price collapses."));
  const created = Number(pair.pairCreatedAt);
  if (Number.isFinite(created) && created > 0) {
    const hours = Math.max(0, (now - created) / 3_600_000);
    const text = hours < 48 ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}` : `${Math.floor(hours / 24)} days`;
    items.push(item("pool-age", "Pool age", `${text} (created ${new Date(created).toISOString().slice(0, 10)})`, hours < THRESHOLDS.poolAgeHours ? "warn" : "ok", "A very new pool has little price history."));
  } else {
    items.push(unavailable("pool-age", "Pool age", "How long the pool has existed."));
  }
  return items;
}

// ---------------------------------------------------------------------------
// One X-Ray

export async function runXray(mintAddress, env, now = Date.now()) {
  const usage = newUsage();
  const rpc = createRpc(env, usage);
  const mintBytes = decodeAddress(mintAddress);
  const [metadataPda, curvePda] = await Promise.all([
    findProgramAddress([encoder.encode("metadata"), decodeAddress(METADATA_PROGRAM_ID), mintBytes], METADATA_PROGRAM_ID),
    findProgramAddress([encoder.encode("bonding-curve"), mintBytes], PUMP_PROGRAM_ID),
  ]);
  const [baseResult, largestResult, pairResult, signalResult] = await Promise.allSettled([
    rpc.accounts([mintAddress, metadataPda, curvePda]),
    rpc.call("getTokenLargestAccounts", [mintAddress, { commitment: "confirmed" }]),
    dexScreenerPairs(mintAddress, usage),
    signalRecord(mintAddress, env, usage),
  ]);
  if (baseResult.status !== "fulfilled") return { status: 502, body: { code: "UPSTREAM_ERROR", error: "Solana data is temporarily unavailable.", usage }, ttl: CACHE_TTL_MS.error };
  const [mintAccount, metadataAccount, curveAccount] = baseResult.value;
  const mint = mintAccount ? parseMint(mintAccount.owner, mintAccount.data) : null;
  if (!mint) return { status: 404, body: { code: "NOT_A_MINT", error: "This address isn't a Solana token mint.", usage }, ttl: CACHE_TTL_MS.partial };
  mint.address = mintAddress;
  let epochUnavailable = false;
  const scheduledFee = mint.extensions.transferFee;
  if (scheduledFee && scheduledFee.older.basisPoints !== scheduledFee.newer.basisPoints) {
    try {
      const info = await rpc.call("getEpochInfo", [{ commitment: "confirmed" }]);
      mint.currentEpoch = Number.isFinite(Number(info?.epoch)) ? BigInt(info.epoch) : null;
    } catch {
      mint.currentEpoch = null;
    }
    epochUnavailable = mint.currentEpoch === null;
  }

  const metadata = metadataAccount && metadataAccount.owner === METADATA_PROGRAM_ID ? parseMetaplexMetadata(metadataAccount.data) : null;
  const curveOk = curveAccount && curveAccount.owner === PUMP_PROGRAM_ID ? decodeBondingCurve(curveAccount.data) : null;
  const curveCreator = curveOk && curveAccount.data.length >= CURVE_CREATOR_OFFSET + 32 ? nonZeroKey(curveAccount.data, CURVE_CREATOR_OFFSET) : null;
  const pair = pairResult.status === "fulfilled" ? pairResult.value : null;
  const signal = signalResult.status === "fulfilled" ? signalResult.value : null;
  let partial = epochUnavailable || pairResult.status !== "fulfilled" || largestResult.status !== "fulfilled" || signal === null;

  // Holder token accounts (and the pool account) in one read, then owners.
  const largest = largestResult.status === "fulfilled" ? (largestResult.value?.value || []) : null;
  let holders = [];
  let ownerAccounts = [];
  let poolAccount = null;
  try {
    const addresses = [...(largest || []).map((entry) => entry.address), ...(pair?.pairAddress ? [pair.pairAddress] : [])];
    const accounts = addresses.length ? await rpc.accounts(addresses) : [];
    if (pair?.pairAddress) poolAccount = accounts.pop();
    const rows = accounts.map((account, index) => {
      const decoded = account && account.data.length >= 72 ? decodeTokenAccount(account.data) : null;
      return decoded && decoded.mint === mintAddress ? { tokenAccount: largest[index].address, owner: decoded.owner, amount: BigInt(largest[index].amount), percent: percentOf(BigInt(largest[index].amount), mint.supply) } : null;
    }).filter(Boolean);
    ownerAccounts = rows.length ? await rpc.accounts(rows.map((row) => row.owner)) : [];
    const coinCreator = poolAccount?.owner === PUMPSWAP_PROGRAM_ID && poolAccount.data.length >= PUMPSWAP_COIN_CREATOR_OFFSET + 32 ? nonZeroKey(poolAccount.data, PUMPSWAP_COIN_CREATOR_OFFSET) : null;
    const creator = curveCreator || coinCreator || (signal?.registered ? signal.creator : null);
    holders = labelHolders(rows, ownerAccounts, { curve: curvePda, pool: pair?.pairAddress, poolLabel: poolAccount && POOL_PROGRAMS[poolAccount.owner], creator });
    mint.creator = creator;
  } catch {
    partial = true;
  }

  const holderWhy = "A few wallets holding a large share can move the price sharply when they sell.";
  const holderItems = [];
  if (largest && holders.length) {
    const counted = holders.filter((holder) => !holder.excluded).slice(0, 10);
    const top10 = counted.reduce((sum, holder) => sum + holder.amount, 0n);
    const percent = percentOf(top10, mint.supply);
    const excludedLabels = [...new Set(holders.filter((holder) => holder.excluded).map((holder) => holder.label))];
    holderItems.push(percent === null
      ? unavailable("top10", "Top 10 holders", holderWhy)
      : item("top10", "Top 10 holders", `${percent}% of supply${excludedLabels.length ? ` (not counting ${excludedLabels.join(", ")})` : ""}`, percent > THRESHOLDS.top10Percent ? "warn" : "ok", holderWhy));
    const creatorHolder = holders.find((holder) => holder.owner === mint.creator);
    if (mint.creator) {
      holderItems.push(item("creator-holding", "Creator's holding", creatorHolder ? `${creatorHolder.percent}% of supply (${short(mint.creator)})` : `Not among the largest holders (${short(mint.creator)})`, creatorHolder && creatorHolder.percent > 5 ? "warn" : "ok", "A creator holding a large share can sell it into buyers."));
    }
  } else {
    holderItems.push(unavailable("top10", "Top 10 holders", holderWhy));
  }
  holderItems.push(...marketItems({ curve: curveOk, pair, poolAccount, now }));
  const onCurve = curveOk && !curveOk.complete;

  const excludedOwners = new Set([curvePda, pair?.pairAddress, ...Object.keys(KNOWN_POOL_AUTHORITIES), ...holders.filter((holder) => holder.excluded).map((holder) => holder.owner)].filter(Boolean));
  const [lp, simulation, sells] = await Promise.all([
    onCurve
      ? Promise.resolve(item("lp", "LP tokens", "Not applicable: liquidity is held by the pump.fun program until graduation", "info", "There are no LP tokens while a token is on the bonding curve."))
      : pair ? lpStatus({ poolAccount, rpc }) : Promise.resolve(unavailable("lp", "LP tokens", "LP tokens are the claim on the pool's liquidity.", "No trading pool was found.")),
    sellSimulation({ mint, holders, ownerAccounts, env, rpc, usage }),
    recentSells({
      mint: mintAddress,
      pools: [...new Set([
        ...(onCurve ? [curvePda] : pair?.pairAddress ? [pair.pairAddress] : []),
        ...holders.filter((holder, index) => holder.excluded && ownerAccounts[index] && POOL_PROGRAMS[ownerAccounts[index].owner] && holder.owner !== curvePda).map((holder) => holder.owner),
      ])].slice(0, MAX_POOLS_FOR_SELLS),
      excludedOwners,
      creator: mint.creator,
      // What a seller receives: SOL, or the pool's other token.
      counterMints: new Set([WRAPPED_SOL_MINT, ...(pair ? [pair.baseToken?.address, pair.quoteToken?.address].filter((address) => address && address !== mintAddress) : [])]),
      rpc,
    }),
  ]);
  holderItems.push(lp);

  const found = mechanisms(mint);
  const honeypotItems = [
    found.length
      ? item("mechanisms", "Sell-blocking or taxing mechanisms", `Found: ${found.join(", ")}`, "warn", "These are the known ways a token can stop, seize or tax sells; see the lines above.")
      : item("mechanisms", "Sell-blocking or taxing mechanisms", "None of the checked mechanisms found (freeze authority, transfer hook, permanent delegate, default-frozen accounts, pausing, non-transferable, transfer fee)", "ok", "These are the known ways a token can stop, seize or tax sells. Other risks remain."),
    simulation,
    sells,
  ];
  if ([...honeypotItems, lp].some((entry) => entry.status === "unavailable")) partial = true;

  const t22 = mint.extensions.tokenMetadata;
  const body = {
    mint: mintAddress,
    name: metadata?.name || t22?.name || null,
    symbol: metadata?.symbol || t22?.symbol || null,
    program: mint.program,
    generatedAt: new Date(now).toISOString(),
    sections: [
      { id: "facts", title: "Hard facts", items: factItems(mint, metadata, signal) },
      { id: "holders", title: "Holders and liquidity", items: holderItems },
      { id: "honeypot", title: "Honeypot checks", items: honeypotItems },
    ],
    holders: holders.slice(0, 10).map((holder) => ({ owner: holder.owner, percent: holder.percent, label: holder.label, excluded: holder.excluded })),
    usage,
    note: "Facts, not a verdict. Conditions can change at any time.",
  };
  const ttl = partial ? CACHE_TTL_MS.partial : CACHE_TTL_MS.full;
  body.cacheSeconds = Math.floor(ttl / 1000);
  return { status: 200, body, ttl };
}

// ---------------------------------------------------------------------------
// HTTP: cache, rate limit, one lookup per mint at a time

const memoryCache = new Map(); // mint -> { status, body, expires }
const inFlight = new Map();
const ipWindows = new Map();

async function allowRequest(ip, env, now) {
  if (env?.XRAY_RATE_LIMITER?.limit) {
    try {
      return (await env.XRAY_RATE_LIMITER.limit({ key: ip })).success;
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
  return new Response(JSON.stringify(body, (_, value) => (typeof value === "bigint" ? value.toString() : value)), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": ttlMs ? `public, max-age=${Math.floor(ttlMs / 1000)}` : "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export function resetXrayForTests() {
  memoryCache.clear();
  inFlight.clear();
  ipWindows.clear();
}

export async function onRequestGet({ request, env, now = Date.now() }) {
  const mint = (new URL(request.url).searchParams.get("mint") || "").trim();
  if (!decodeAddress(mint)) return respond(400, { code: "INVALID_MINT", error: "Enter a Solana token mint address." }, 0);

  const cached = memoryCache.get(mint);
  if (cached && cached.expires > now) return respond(cached.status, cached.body, cached.expires - now);
  const edgeCache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://xray.cache/${mint}`);
  if (edgeCache) {
    const hit = await edgeCache.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }

  if (!inFlight.has(mint)) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await allowRequest(ip, env, now))) {
      return new Response(JSON.stringify({ code: "RATE_LIMITED", error: "Too many X-Rays; try again in a minute." }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(RATE_LIMIT.windowMs / 1000), "cache-control": "no-store" },
      });
    }
  }
  let pending = inFlight.get(mint);
  if (!pending) {
    pending = runXray(mint, env, now)
      .catch(() => ({ status: 502, body: { code: "UPSTREAM_ERROR", error: "Solana data is temporarily unavailable." }, ttl: CACHE_TTL_MS.error }))
      .finally(() => inFlight.delete(mint));
    inFlight.set(mint, pending);
  }
  const result = await pending;
  if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(mint, { status: result.status, body: result.body, expires: now + result.ttl });
  const response = respond(result.status, result.body, result.ttl);
  if (edgeCache) await edgeCache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}
