// Signal X-Ray (functions/api/solana/xray.js) with every upstream mocked:
// RPC (Helius), DEX Screener, Jupiter and the Signal API. Token-2022 test
// mints are built byte-for-byte with each honeypot extension.
//
// Run with: node apps/web/tests/xray-function.test.mjs
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import * as xray from "../../../functions/api/solana/xray.js";
import { decodeAddress, encodeAddress, findProgramAddress } from "../../../functions/api/solana/token-market.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let passed = 0;
async function test(name, fn) {
  xray.resetXrayForTests();
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

// ---- addresses --------------------------------------------------------------------------
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
let seed = 1;
const key = () => {
  const bytes = new Uint8Array(32);
  bytes[0] = seed++;
  bytes[31] = 7;
  return encodeAddress(bytes);
};
const RPC = "https://helius.test/?api-key=test";
const env = { SOLANA_RPC_URL: RPC, JUPITER_API_KEY: "jup-test", SIGNAL_API_ORIGIN: "https://signal-api.test" };

// ---- account bytes ------------------------------------------------------------------------
const pubkeyBytes = (address) => decodeAddress(address);
function u64le(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}
function u16le(value) {
  return Uint8Array.of(value & 0xff, value >> 8);
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const option = (address) => (address ? concat(Uint8Array.of(1, 0, 0, 0), pubkeyBytes(address)) : new Uint8Array(36));
const pubkeyOrZero = (address) => (address ? pubkeyBytes(address) : new Uint8Array(32));

/** An SPL / Token-2022 mint; `extensions` makes it Token-2022 with TLV data. */
function mintBytes({ mintAuthority = null, freezeAuthority = null, supply = 1_000_000_000_000_000n, decimals = 6, extensions = [] } = {}) {
  const base = concat(option(mintAuthority), u64le(supply), Uint8Array.of(decimals, 1), option(freezeAuthority));
  if (!extensions.length) return base;
  const tlv = extensions.map(([type, data]) => concat(u16le(type), u16le(data.length), data));
  return concat(base, new Uint8Array(165 - 82), Uint8Array.of(1), ...tlv);
}
const EXT = {
  transferFee: (bps, authority = null) => [1, concat(pubkeyOrZero(authority), new Uint8Array(32), u64le(0), u64le(0), u64le(1_000_000), u16le(bps), u64le(0), u64le(1_000_000), u16le(bps))],
  transferHook: (program) => [14, concat(new Uint8Array(32), pubkeyBytes(program))],
  permanentDelegate: (delegate) => [12, pubkeyBytes(delegate)],
  defaultFrozen: () => [6, Uint8Array.of(2)],
  pausable: (authority, paused) => [26, concat(pubkeyBytes(authority), Uint8Array.of(paused ? 1 : 0))],
  nonTransferable: () => [9, new Uint8Array(0)],
};

function borshString(value) {
  const bytes = new TextEncoder().encode(value);
  return concat(new Uint8Array(new Uint32Array([bytes.length]).buffer), bytes);
}
function metaplexBytes({ mint, updateAuthority, name = "Test", symbol = "TST", isMutable = false }) {
  return concat(Uint8Array.of(4), pubkeyBytes(updateAuthority), pubkeyBytes(mint), borshString(name), borshString(symbol), borshString("https://x.test/m.json"), u16le(0), Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(isMutable ? 1 : 0), new Uint8Array(20));
}
function curveBytes({ complete = false, realSol = 20_000_000_000n, creator }) {
  return concat(Uint8Array.of(23, 183, 248, 55, 96, 216, 172, 96), u64le(1n), u64le(1n), u64le(1n), u64le(realSol), u64le(1_000_000_000_000_000n), Uint8Array.of(complete ? 1 : 0), pubkeyBytes(creator), new Uint8Array(70));
}
function pumpSwapPoolBytes({ baseMint, lpMint, coinCreator, lpIssued = 0n }) {
  const bytes = new Uint8Array(301);
  bytes.set(pubkeyBytes(baseMint), 43);
  bytes.set(pubkeyBytes(lpMint), 107);
  bytes.set(u64le(lpIssued), 203);
  bytes.set(pubkeyBytes(coinCreator), 211);
  return bytes;
}
const tokenAccountBytes = (mint, owner, amount) => concat(pubkeyBytes(mint), pubkeyBytes(owner), u64le(amount), new Uint8Array(165 - 72));
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// ---- mocked network -------------------------------------------------------------------
function network(state) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === RPC || u.startsWith("https://api.mainnet-beta") || u.startsWith("https://solana-rpc")) {
      const payload = JSON.parse(init.body);
      const answer = (request) => {
        calls.push(request.method);
        const [first, options] = request.params;
        switch (request.method) {
          case "getMultipleAccounts":
            return { value: first.map((address) => {
              const account = state.accounts[address];
              return account ? { owner: account.owner, lamports: Number(account.lamports ?? 1_000_000), data: [b64(account.data ?? new Uint8Array(0)), "base64"] } : null;
            }) };
          case "getTokenLargestAccounts":
            if (state.largestError) throw Object.assign(new Error("rate"), { rpcError: true });
            return { value: (state.largest[first] || []).map(([address, amount]) => ({ address, amount: String(amount) })) };
          case "getTokenSupply":
            return { value: { amount: String(state.supply[first] ?? 0) } };
          case "getSignaturesForAddress":
            if (state.failingPools?.has(first)) throw new Error("rate limited");
            return (state.signatures[first] || []).map((signature) => ({ signature, err: null }));
          case "getTransaction":
            if (state.flaky?.has(first)) {
              state.flaky.delete(first);
              throw new Error("rate limited");
            }
            return state.transactions[first] ?? null;
          case "getEpochInfo":
            if (state.epoch === undefined) throw new Error("no epoch");
            return { epoch: state.epoch };
          case "simulateTransaction":
            state.simulated = { tx: first, options };
            return { value: state.simulation ?? { err: null, logs: [] } };
          default:
            throw new Error(`unexpected RPC ${request.method}`);
        }
      };
      const reply = (request) => {
        try {
          return { jsonrpc: "2.0", id: request.id, result: answer(request) };
        } catch {
          return { jsonrpc: "2.0", id: request.id, error: { code: 429, message: "rate limited" } };
        }
      };
      return Response.json(Array.isArray(payload) ? payload.map(reply) : reply(payload));
    }
    if (u.startsWith("https://api.dexscreener.com/tokens/v1/solana/")) {
      calls.push("dexscreener");
      if (state.dexDown) return new Response("down", { status: 503 });
      return Response.json(state.pairs || []);
    }
    if (u.startsWith("https://api.jup.ag/swap/v2/order")) {
      calls.push("jupiter");
      state.jupiterUrl = u;
      return state.noRoute ? Response.json({ error: "no route" }, { status: 400 }) : Response.json({ transaction: "AQIDBA==" });
    }
    if (u.startsWith("https://signal-api.test/api/v1/tokens/solana/")) {
      calls.push("signal-api");
      if (state.signalDown) throw new Error("asleep");
      return state.signalToken ? Response.json({ token: state.signalToken }) : Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

/** A realistic token: a pump.fun bonding-curve coin, or graduated to PumpSwap. */
async function scenario({ graduated = false, mint = key(), mintData, lpSupply = 0n, lpIssued = 0n, lpHolders = [], meteora = false, simulation, extra = {} } = {}) {
  const creator = key();
  const [curve, metadataPda] = await Promise.all([
    findProgramAddress([new TextEncoder().encode("bonding-curve"), decodeAddress(mint)], PUMP),
    findProgramAddress([new TextEncoder().encode("metadata"), decodeAddress(METADATA), decodeAddress(mint)], METADATA),
  ]);
  const holderA = key();
  const holderB = key();
  const pool = key();
  const lpMint = key();
  const [ataA, ataB] = await Promise.all([holderA, holderB].map((owner) => findProgramAddress([decodeAddress(owner), decodeAddress(TOKEN), decodeAddress(mint)], ATA_PROGRAM)));
  const curveVault = key();
  const poolVault = key();
  const creatorAccount = key();
  const accounts = {
    [mint]: { owner: TOKEN, data: mintData ?? mintBytes() },
    [metadataPda]: { owner: METADATA, data: metaplexBytes({ mint, updateAuthority: key(), name: "Test Coin", symbol: "TST" }) },
    [curve]: { owner: PUMP, data: curveBytes({ complete: graduated, creator }) },
    // Holders' token accounts (supply 1,000,000,000 tokens at 6 decimals):
    [curveVault]: { owner: TOKEN, data: tokenAccountBytes(mint, curve, 600_000_000_000_000n) },
    [poolVault]: { owner: TOKEN, data: tokenAccountBytes(mint, pool, 500_000_000_000_000n) },
    [ataA]: { owner: TOKEN, data: tokenAccountBytes(mint, holderA, 80_000_000_000_000n) },
    [creatorAccount]: { owner: TOKEN, data: tokenAccountBytes(mint, creator, 60_000_000_000_000n) },
    [ataB]: { owner: TOKEN, data: tokenAccountBytes(mint, holderB, 40_000_000_000_000n) },
    // Owners: the curve and pool are program accounts; holders are wallets with SOL.
    [holderA]: { owner: SYSTEM, lamports: 50_000_000, data: new Uint8Array(0) },
    [holderB]: { owner: SYSTEM, lamports: 50_000_000, data: new Uint8Array(0) },
    [creator]: { owner: SYSTEM, lamports: 50_000_000, data: new Uint8Array(0) },
    [pool]: { owner: PUMPSWAP, data: pumpSwapPoolBytes({ baseMint: mint, lpMint, coinCreator: creator, lpIssued }) },
  };
  const meteoraPool = key();
  const meteoraVault = key();
  if (meteora) {
    accounts[meteoraPool] = { owner: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", data: new Uint8Array(900) };
    accounts[meteoraVault] = { owner: TOKEN, data: tokenAccountBytes(mint, meteoraPool, 90_000_000_000_000n) };
  }
  const largest = graduated
    ? [[poolVault, 500_000_000_000_000n], [ataA, 80_000_000_000_000n], [creatorAccount, 60_000_000_000_000n], [ataB, 40_000_000_000_000n]]
    : [[curveVault, 600_000_000_000_000n], [ataA, 80_000_000_000_000n], [creatorAccount, 60_000_000_000_000n], [ataB, 40_000_000_000_000n]];
  const target = graduated ? pool : curve;
  if (meteora) largest.splice(1, 0, [meteoraVault, 90_000_000_000_000n]);
  // Recent transactions: two sells by holders, one by the creator, one buy.
  // A swap between `owner` and the pool: tokens one way, SOL (lamports) the other.
  const tx = (owner, pre, post, { solDelta = (pre - post) * 10, wsol = false } = {}) => ({
    transaction: { message: { accountKeys: [owner, target] } },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000, 5_000_000_000],
      postBalances: [1_000_000_000 - 5000 + (wsol ? 0 : solDelta), 5_000_000_000 - (wsol ? 0 : solDelta)],
      preTokenBalances: [{ mint, owner, uiTokenAmount: { amount: String(pre) } }, { mint, owner: target, uiTokenAmount: { amount: "1000" } }, ...(wsol ? [{ mint: "So11111111111111111111111111111111111111112", owner, uiTokenAmount: { amount: "0" } }] : [])],
      postTokenBalances: [{ mint, owner, uiTokenAmount: { amount: String(post) } }, { mint, owner: target, uiTokenAmount: { amount: String(1000 + pre - post) } }, ...(wsol ? [{ mint: "So11111111111111111111111111111111111111112", owner, uiTokenAmount: { amount: String(solDelta) } }] : [])],
    },
  });
  const lpAccounts = {};
  const lpLargest = [];
  for (const [owner, amount, ownerProgram] of lpHolders) {
    const account = key();
    lpAccounts[account] = { owner: TOKEN, data: tokenAccountBytes(lpMint, owner, amount) };
    lpAccounts[owner] = lpAccounts[owner] || { owner: ownerProgram || SYSTEM, lamports: 1_000_000, data: new Uint8Array(0) };
    lpLargest.push([account, amount]);
  }
  const state = {
    accounts: { ...accounts, ...lpAccounts },
    largest: { [mint]: largest, [lpMint]: lpLargest },
    supply: { [lpMint]: lpSupply },
    signatures: { [target]: ["s1", "s2", "s3", "s4", "s5"], [meteoraPool]: ["m1", "m2"] },
    transactions: {
      s1: tx(holderA, 500, 400),
      s2: tx(holderB, 300, 100, { wsol: true }), // paid out in WSOL
      s3: tx(creator, 900, 0),
      s4: tx(holderA, 400, 700), // a buy
      // Adding liquidity: tokens AND SOL go into the pool; not a sell.
      s5: tx(holderB, 200, 100, { solDelta: -1_000 }),
      s6: tx(holderB, 100, 300), // a buy
      s7: tx(holderA, 700, 900), // a buy
      m1: tx(holderB, 900, 800), // sells through the Meteora pool
      m2: tx(holderA, 900, 850),
    },
    pairs: graduated ? [{ dexId: "pumpswap", pairAddress: pool, baseToken: { address: mint }, quoteToken: { address: "So11111111111111111111111111111111111111112" }, liquidity: { usd: 25_000 }, pairCreatedAt: Date.parse("2026-09-01T00:00:00Z"), txns: { h1: { buys: 400, sells: 600 }, h24: { buys: 9_000, sells: 8_000 } } }] : [{ dexId: "pumpfun", pairAddress: curve, baseToken: { address: mint }, quoteToken: { address: "So11111111111111111111111111111111111111112" } }],
    simulation,
    ...extra,
  };
  return { mint, creator, curve, pool, meteoraPool, holderA, holderB, state };
}

const NOW = Date.parse("2026-09-30T12:00:00Z");
const run = (mint) => xray.runXray(mint, env, NOW);
const find = (body, id) => body.sections.flatMap((section) => section.items).find((entry) => entry.id === id);
const BANNED = /\bsafe\b|not a honeypot|honeypot-free|rug-?free|\bscore\b|\bverdict:/i;

console.log("xray-function.test.mjs\n");

// ---- hard facts -----------------------------------------------------------------------------
await test("bonding-curve coin: hard facts, each with a marker and a why; no verdict words anywhere", async () => {
  const s = await scenario();
  network(s.state);
  const { status, body } = await run(s.mint);
  assert.equal(status, 200);
  assert.equal(body.name, "Test Coin");
  assert.equal(find(body, "mint-authority").value, "Revoked");
  assert.equal(find(body, "mint-authority").status, "ok");
  assert.equal(find(body, "freeze-authority").value, "Revoked");
  assert.equal(find(body, "metadata").value, "Immutable");
  assert.equal(find(body, "supply").value, "1,000,000,000 tokens (6 decimals)");
  assert.equal(find(body, "program").value, "SPL Token");
  assert.equal(find(body, "transfer-hook"), undefined, "SPL tokens don't list Token-2022 extensions");
  for (const entry of body.sections.flatMap((section) => section.items)) {
    assert.ok(["ok", "warn", "info", "unavailable"].includes(entry.status), entry.id);
    assert.ok(entry.why && entry.why.length > 10, `${entry.id} has a why`);
  }
  assert.doesNotMatch(JSON.stringify(body), BANNED);
});

await test("active mint and freeze authority, mutable metadata: flagged with who holds them", async () => {
  const mintAuthority = key();
  const freezeAuthority = key();
  const s = await scenario({ mintData: mintBytes({ mintAuthority, freezeAuthority }) });
  const metadataPda = await findProgramAddress([new TextEncoder().encode("metadata"), decodeAddress(METADATA), decodeAddress(s.mint)], METADATA);
  s.state.accounts[metadataPda].data = metaplexBytes({ mint: s.mint, updateAuthority: freezeAuthority, isMutable: true });
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "mint-authority").status, "warn");
  assert.match(find(body, "mint-authority").value, /^Active \(/);
  assert.equal(find(body, "freeze-authority").status, "warn");
  assert.match(find(body, "metadata").value, /^Mutable/);
  assert.match(find(body, "mechanisms").value, /freeze authority/);
});

// ---- Token-2022 honeypot mints -----------------------------------------------------------------
const hookProgram = key();
const delegate = key();
const pauseAuthority = key();
const feeAuthority = key();
for (const [name, extensions, id, expected] of [
  ["transfer fee 5% with a fee authority", [EXT.transferFee(500, feeAuthority)], "transfer-fee", /^5% now; fee authority/],
  ["transfer hook", [EXT.transferHook(hookProgram)], "transfer-hook", /^Program /],
  ["permanent delegate", [EXT.permanentDelegate(delegate)], "permanent-delegate", /…/],
  ["accounts frozen by default", [EXT.defaultFrozen()], "default-frozen", /^Yes$/],
  ["pausable, paused right now", [EXT.pausable(pauseAuthority, true)], "pausable", /^Paused right now$/],
  ["pausable, not paused", [EXT.pausable(pauseAuthority, false)], "pausable", /^Yes \(pause authority/],
  ["non-transferable", [EXT.nonTransferable()], "non-transferable", /^Yes$/],
]) {
  await test(`Token-2022 honeypot mint (${name}): flagged ⚠️ and listed among the mechanisms`, async () => {
    const s = await scenario({ mintData: mintBytes({ extensions }) });
    s.state.accounts[s.mint].owner = TOKEN_2022;
    network(s.state);
    const { body } = await run(s.mint);
    assert.equal(find(body, "program").value, "Token-2022");
    assert.equal(find(body, id).status, "warn", id);
    assert.match(find(body, id).value, expected);
    assert.equal(find(body, "mechanisms").status, "warn");
    assert.match(find(body, "mechanisms").value, /^Found: /);
    // The other extensions stay ✅.
    for (const other of ["transfer-fee", "transfer-hook", "permanent-delegate", "default-frozen", "pausable", "non-transferable"]) {
      if (other !== id) assert.equal(find(body, other).status, "ok", other);
    }
  });
}

/** A transfer fee that changes from `olderBps` to `newerBps` at `epoch`. */
const scheduledFee = (olderBps, newerBps, epoch) => [1, concat(new Uint8Array(32), new Uint8Array(32), u64le(0), u64le(0), u64le(1_000_000), u16le(olderBps), u64le(epoch), u64le(1_000_000), u16le(newerBps))];

await test("scheduled fee change, before its epoch: the active (older) fee is shown, the new one as scheduled", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [scheduledFee(0, 1000, 900)] }), extra: { epoch: 850 } });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  const calls = network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "transfer-fee").value, "0% now, changing to 10% at epoch 900");
  assert.equal(find(body, "transfer-fee").status, "warn");
  assert.match(find(body, "transfer-fee").why, /starts at epoch 900/);
  assert.match(find(body, "mechanisms").value, /transfer fee scheduled \(10% from epoch 900\)/);
  assert.doesNotMatch(find(body, "mechanisms").value, /transfer fee \(10%\)/);
  assert.ok(calls.includes("getEpochInfo"));
});

await test("scheduled fee change, after its epoch: the newer fee is the one in force", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [scheduledFee(1000, 200, 900)] }), extra: { epoch: 901 } });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "transfer-fee").value, "2% now");
  assert.match(find(body, "mechanisms").value, /transfer fee \(2%\)/);
});

await test("scheduled fee change with the epoch unreadable: both fees shown as possible, ⚠️, cached briefly", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [scheduledFee(100, 500, 900)] }) });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  network(s.state);
  const { body, ttl } = await run(s.mint);
  assert.match(find(body, "transfer-fee").value, /^1% or 5% \(5% from epoch 900; the current epoch couldn't be read\)/);
  assert.match(find(body, "mechanisms").value, /transfer fee \(up to 5%\)/);
  assert.equal(ttl, xray.CACHE_TTL_MS.partial);
});

await test("an unchanging fee needs no epoch read", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [EXT.transferFee(300)] }) });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  const calls = network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "transfer-fee").value, "3% now");
  assert.ok(!calls.includes("getEpochInfo"));
});

await test("Token-2022 with a 0% fee and no authority, and none of the mechanisms: all ✅, no mechanisms found", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [EXT.transferFee(0)] }) });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "transfer-fee").value, "0%");
  assert.equal(find(body, "transfer-fee").status, "ok");
  assert.equal(find(body, "mechanisms").status, "ok");
  assert.match(find(body, "mechanisms").value, /^None of the checked mechanisms found/);
});

await test("a 0% fee that its authority can raise: ⚠️ with the right wording", async () => {
  const s = await scenario({ mintData: mintBytes({ extensions: [EXT.transferFee(0, feeAuthority)] }) });
  s.state.accounts[s.mint].owner = TOKEN_2022;
  network(s.state);
  const { body } = await run(s.mint);
  assert.match(find(body, "transfer-fee").value, /^0% now; fee authority/);
  assert.equal(find(body, "transfer-fee").status, "warn");
  assert.match(find(body, "mechanisms").value, /transfer fee authority \(0% now\)/);
});

// ---- holders and liquidity -----------------------------------------------------------------------
await test("top 10 holders exclude the bonding curve (labelled); creator's holding shown; market on the curve; LP not applicable", async () => {
  const s = await scenario();
  network(s.state);
  const { body } = await run(s.mint);
  // Wallets: 8% + 6% (creator) + 4% = 18%; the curve's 60% isn't counted.
  assert.equal(find(body, "top10").value, "18% of supply (not counting pump.fun bonding curve)");
  assert.equal(find(body, "top10").status, "ok");
  assert.match(find(body, "creator-holding").value, /^6% of supply/);
  assert.equal(find(body, "creator-holding").status, "warn");
  assert.deepEqual(body.holders[0], { owner: s.curve, percent: 60, label: "pump.fun bonding curve", excluded: true });
  assert.equal(body.holders.find((h) => h.owner === s.creator).label, "creator");
  assert.match(find(body, "market").value, /^On the pump.fun bonding curve/);
  assert.equal(find(body, "liquidity").value, "20 SOL in the bonding curve");
  assert.match(find(body, "lp").value, /^Not applicable: liquidity is held by the pump.fun program/);
});

await test("graduated to PumpSwap with LP burned: pool excluded, liquidity, pool age, 100% burned ✅", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n });
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "top10").value, "18% of supply (not counting PumpSwap pool)");
  assert.equal(find(body, "market").value, "Graduated from pump.fun; trading on PumpSwap pool");
  assert.equal(find(body, "liquidity").value, "$25,000 (DEX Screener)");
  assert.equal(find(body, "liquidity").status, "ok");
  assert.equal(find(body, "pool-age").value, "29 days (created 2026-09-01)");
  assert.equal(find(body, "lp").value, "100% burned");
  assert.equal(find(body, "lp").status, "ok");
});

await test("LP held by a wallet: ⚠️ naming the share; LP sent to the incinerator: ✅ burned", async () => {
  const holder = key();
  let s = await scenario({ graduated: true, lpSupply: 1000n, lpHolders: [[holder, 900n], [INCINERATOR, 100n]] });
  network(s.state);
  let { body } = await run(s.mint);
  assert.match(find(body, "lp").value, /^10% burned; 90% held by wallets of the LP tokens that still exist \(largest .*\)$/);
  assert.equal(find(body, "lp").status, "warn");
  xray.resetXrayForTests();
  s = await scenario({ graduated: true, lpSupply: 1000n, lpHolders: [[INCINERATOR, 1000n]] });
  network(s.state);
  ({ body } = await run(s.mint));
  assert.equal(find(body, "lp").value, "100% burned");
  assert.equal(find(body, "lp").status, "ok");
});

await test("PumpSwap LP mostly burned (PAID's real numbers): burned share counted from the pool's issued LP; small wallet leftover ✅", async () => {
  const wallets = [[key(), 3_144_431_697n], [key(), 752_964_574n], [key(), 148_929_078n], [key(), 3_934_590n]];
  const s = await scenario({ graduated: true, lpIssued: 4_197_438_549_426n, lpSupply: 4_050_259_939n, lpHolders: wallets });
  network(s.state);
  const { body } = await run(s.mint);
  assert.match(find(body, "lp").value, /^99\.9% burned; 0\.09% held by wallets \(largest .*\)$/);
  assert.equal(find(body, "lp").status, "ok");
  assert.match(find(body, "lp").why, /Almost all LP tokens are burned/);
});

await test("PumpSwap LP where wallets hold a real share of the issued LP: ⚠️", async () => {
  const s = await scenario({ graduated: true, lpIssued: 1_000_000n, lpSupply: 400_000n, lpHolders: [[key(), 400_000n]] });
  network(s.state);
  const { body } = await run(s.mint);
  assert.match(find(body, "lp").value, /^60% burned; 40% held by wallets \(largest .*\)$/);
  assert.equal(find(body, "lp").status, "warn");
});

await test("lines with a shortened address carry the full address (authorities, creator, LP wallet, simulated holder)", async () => {
  const mintAuthority = key();
  const freezeAuthority = key();
  const lpWallet = key();
  const s = await scenario({ graduated: true, mintData: mintBytes({ mintAuthority, freezeAuthority }), lpIssued: 1_000_000n, lpSupply: 400_000n, lpHolders: [[lpWallet, 400_000n]] });
  network(s.state);
  const { body } = await run(s.mint);
  assert.deepEqual(find(body, "mint-authority").addresses, [mintAuthority]);
  assert.deepEqual(find(body, "freeze-authority").addresses, [freezeAuthority]);
  assert.deepEqual(find(body, "creator-holding").addresses, [s.creator]);
  assert.deepEqual(find(body, "lp").addresses, [lpWallet]);
  assert.deepEqual(find(body, "sell-simulation").addresses, [s.holderA]);
  for (const entry of body.sections.flatMap((section) => section.items)) {
    for (const address of entry.addresses || []) assert.ok(entry.value.includes(xray.short(address)), `${entry.id} shows ${address} shortened`);
  }
  assert.equal(find(body, "supply").addresses, undefined, "lines without an address have none");
});

await test("a holder owned by an unrecognised program: labelled 'program account (…)', with that program's full address", async () => {
  const s = await scenario();
  const program = key();
  s.state.accounts[s.holderB].owner = program; // holderB is now an account of an unknown program
  network(s.state);
  const { body } = await run(s.mint);
  const row = body.holders.find((holder) => holder.owner === s.holderB);
  assert.equal(row.label, `program account (${xray.short(program)})`);
  assert.equal(row.labelAddress, program);
  assert.equal(body.holders.find((holder) => holder.owner === s.holderA).labelAddress, undefined);
});

await test("percentages are shown with two decimals", async () => {
  assert.equal(xray.percentOf(1n, 3n), 33.33);
  assert.equal(xray.percentOf(245_002n, 1_000_000n), 24.5);
  assert.equal(xray.percentOf(1n, 0n), null);
});

await test("thin, brand-new pool: liquidity and pool age flagged ⚠️", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n });
  s.state.pairs[0].liquidity.usd = 2_000;
  s.state.pairs[0].pairCreatedAt = NOW - 3 * 3_600_000;
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "liquidity").status, "warn");
  assert.equal(find(body, "pool-age").value, "3 hours (created 2026-09-30)");
  assert.equal(find(body, "pool-age").status, "warn");
});

// ---- honeypot: sell simulation and recent sells ------------------------------------------------------
await test("sell simulation: a real holder's 1% sell, simulated only (sigVerify off, fresh blockhash); never sent", async () => {
  const s = await scenario();
  const calls = network(s.state);
  const { body } = await run(s.mint);
  const sim = find(body, "sell-simulation");
  assert.equal(sim.status, "ok");
  assert.match(sim.value, /^Succeeded right now for a holder \(.*\) selling 800,000 tokens$/);
  const order = new URL(s.state.jupiterUrl);
  assert.equal(order.searchParams.get("taker"), s.holderA, "the largest wallet holder with SOL and an associated account");
  assert.equal(order.searchParams.get("inputMint"), s.mint);
  assert.equal(order.searchParams.get("amount"), "800000000000");
  assert.equal(s.state.simulated.options.sigVerify, false);
  assert.equal(s.state.simulated.options.replaceRecentBlockhash, true);
  assert.ok(!calls.includes("sendTransaction") && !calls.includes("sendRawTransaction"), "nothing is ever sent");
});

await test("sell simulation failing on a frozen account: ⚠️ 'Failed right now … frozen'", async () => {
  const s = await scenario({ simulation: { err: { InstructionError: [2, { Custom: 17 }] }, logs: ["Program log: Error: Account is frozen"] } });
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "sell-simulation").status, "warn");
  assert.match(find(body, "sell-simulation").value, /^Failed right now for .*: a token account is frozen$/);
});

await test("sell simulation: transfer hook rejection ⚠️; no route or no key → Unavailable, never guessed", async () => {
  let s = await scenario({ simulation: { err: { InstructionError: [3, { Custom: 6001 }] }, logs: ["Program log: transfer hook denied the transfer"] } });
  network(s.state);
  assert.match(find((await run(s.mint)).body, "sell-simulation").value, /the transfer hook rejected it$/);
  xray.resetXrayForTests();
  s = await scenario({ extra: { noRoute: true } });
  network(s.state);
  const noRoute = find((await run(s.mint)).body, "sell-simulation");
  assert.equal(noRoute.value, "Unavailable");
  assert.equal(noRoute.status, "unavailable");
  assert.match(noRoute.reason, /No sell route/);
  xray.resetXrayForTests();
  s = await scenario();
  network(s.state);
  const noKey = find((await xray.runXray(s.mint, { ...env, JUPITER_API_KEY: "" }, NOW)).body, "sell-simulation");
  assert.equal(noKey.value, "Unavailable");
});

await test("recent sells: successful sells by non-creator wallets counted (SOL or WSOL received); the creator's sell and buys aren't", async () => {
  const s = await scenario();
  network(s.state);
  const { body } = await run(s.mint);
  const sells = find(body, "recent-sells");
  assert.equal(sells.value, "2 successful sells by 2 non-creator wallets in the last 5 wallet trades (from 5 transactions across 1 pool)");
  assert.equal(sells.status, "ok");
});

await test("recent sells: a liquidity deposit (tokens and SOL into the pool) isn't a sell", async () => {
  const s = await scenario();
  s.state.signatures[s.curve] = ["s5", "s4", "s6", "s7", "s3"]; // a deposit, buys and the creator's sell
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "recent-sells").value, "No successful sells by non-creator wallets in the last 5 wallet trades (from 5 transactions across 1 pool)");
  assert.equal(find(body, "recent-sells").status, "warn");
});

await test("recent sells: too few readable transactions → 'Not enough recent data', not a warning", async () => {
  const s = await scenario();
  s.state.signatures[s.curve] = ["s3", "s4"];
  network(s.state);
  const { body } = await run(s.mint);
  const sells = find(body, "recent-sells");
  assert.equal(sells.value, "Not enough recent data");
  assert.equal(sells.status, "unavailable");
  assert.match(sells.reason, /^Only 2 of 2 recent pool transactions could be read/);
});

await test("recent sells: the token's other pools found among its holders (Meteora DLMM) are read too", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  const calls = network(s.state);
  const { body } = await run(s.mint);
  // PumpSwap: 2 sells (holders A and B); Meteora: 2 more by the same wallets.
  assert.equal(find(body, "recent-sells").value, "4 successful sells by 2 non-creator wallets in the last 7 wallet trades (from 7 transactions across 2 pools)");
  assert.equal(calls.filter((method) => method === "getSignaturesForAddress").length, 2);
  assert.equal(find(body, "top10").value, "18% of supply (not counting PumpSwap pool, Meteora DLMM pool)");
});

await test("recent sells: a pool whose transactions can't be listed isn't counted as read; no sells then → 'Not enough recent data'", async () => {
  // Sells found in the pool that was read: reported, noting the other pool.
  let s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  s.state.failingPools = new Set([s.meteoraPool]);
  network(s.state);
  let { body } = await run(s.mint);
  assert.equal(find(body, "recent-sells").value, "2 successful sells by 2 non-creator wallets in the last 5 wallet trades (from 5 transactions across 1 pool; 1 more pool couldn't be read)");
  // No sells in the pool that was read: no "no sells" claim.
  xray.resetXrayForTests();
  s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  s.state.failingPools = new Set([s.meteoraPool]);
  s.state.signatures[s.pool] = ["s3", "s4", "s5", "s6", "s7"];
  network(s.state);
  ({ body } = await run(s.mint));
  const sells = find(body, "recent-sells");
  assert.equal(sells.value, "Not enough recent data");
  assert.equal(sells.status, "unavailable");
  assert.match(sells.reason, /1 of 2 pools couldn't be read/);
});

await test("recent sells: a sell paid out in a secondary pool's own quote token (USDC) is counted", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  // holderB sells 100 tokens into the Meteora pool and gets 50 USDC from it;
  // no SOL moves.
  s.state.transactions.m1 = {
    transaction: { message: { accountKeys: [s.holderB, s.meteoraPool] } },
    meta: {
      err: null, fee: 5000, preBalances: [1_000_000_000, 1], postBalances: [999_995_000, 1],
      preTokenBalances: [{ mint: s.mint, owner: s.holderB, uiTokenAmount: { amount: "900" } }, { mint: USDC, owner: s.meteoraPool, uiTokenAmount: { amount: "1000" } }, { mint: USDC, owner: s.holderB, uiTokenAmount: { amount: "0" } }],
      postTokenBalances: [{ mint: s.mint, owner: s.holderB, uiTokenAmount: { amount: "800" } }, { mint: USDC, owner: s.meteoraPool, uiTokenAmount: { amount: "950" } }, { mint: USDC, owner: s.holderB, uiTokenAmount: { amount: "50" } }],
    },
  };
  // holderA deposits tokens and USDC into the Meteora pool: not a sell.
  s.state.transactions.m2 = {
    transaction: { message: { accountKeys: [s.holderA, s.meteoraPool] } },
    meta: {
      err: null, fee: 5000, preBalances: [1_000_000_000, 1], postBalances: [999_995_000, 1],
      preTokenBalances: [{ mint: s.mint, owner: s.holderA, uiTokenAmount: { amount: "900" } }, { mint: USDC, owner: s.holderA, uiTokenAmount: { amount: "100" } }, { mint: USDC, owner: s.meteoraPool, uiTokenAmount: { amount: "1000" } }],
      postTokenBalances: [{ mint: s.mint, owner: s.holderA, uiTokenAmount: { amount: "850" } }, { mint: USDC, owner: s.holderA, uiTokenAmount: { amount: "0" } }, { mint: USDC, owner: s.meteoraPool, uiTokenAmount: { amount: "1100" } }],
    },
  };
  s.state.signatures[s.pool] = ["s3", "s4", "s6", "s7"]; // no sells in the PumpSwap pool
  network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "recent-sells").value, "1 successful sell by 1 non-creator wallet in the last 6 wallet trades (from 6 transactions across 2 pools)");
});

await test("PumpSwap LP spread over many small wallets: all listed accounts are counted, so 6% of issued LP is ⚠️", async () => {
  const wallets = Array.from({ length: 10 }, () => [key(), 6_000n]); // 10 x 0.6% of 1,000,000 issued
  const s = await scenario({ graduated: true, lpIssued: 1_000_000n, lpSupply: 60_000n, lpHolders: wallets });
  network(s.state);
  const { body } = await run(s.mint);
  assert.match(find(body, "lp").value, /^94% burned; 6% held by wallets \(largest .*\)$/);
  assert.equal(find(body, "lp").status, "warn");
});

await test("LP not among the listed accounts counts against ✅ (it could be wallet-held)", async () => {
  const s = await scenario({ graduated: true, lpIssued: 1_000_000n, lpSupply: 60_000n, lpHolders: [[key(), 10_000n]] });
  network(s.state);
  const { body } = await run(s.mint);
  assert.match(find(body, "lp").value, /^94% burned; 1% held by wallets \(largest .*\); 5% in smaller holdings not checked$/);
  assert.equal(find(body, "lp").status, "warn");
});

await test("recent sells: bot arbitrage between pools (no wallet's balance changes) isn't counted; too few wallet trades → 'Not enough recent data', not ⚠️", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  const bot = key();
  // The bot buys from PumpSwap and sells into Meteora in one transaction:
  // tokens go pool → pool; the bot's own balance doesn't change.
  const arb = (n) => ({
    transaction: { message: { accountKeys: [bot, s.pool, s.meteoraPool] } },
    meta: {
      err: null, fee: 5000, preBalances: [1_000_000_000, 1, 1], postBalances: [1_000_100_000, 1, 1],
      preTokenBalances: [{ mint: s.mint, owner: s.pool, uiTokenAmount: { amount: "10000" } }, { mint: s.mint, owner: s.meteoraPool, uiTokenAmount: { amount: "10000" } }, { mint: s.mint, owner: bot, uiTokenAmount: { amount: "0" } }],
      postTokenBalances: [{ mint: s.mint, owner: s.pool, uiTokenAmount: { amount: String(10000 - n) } }, { mint: s.mint, owner: s.meteoraPool, uiTokenAmount: { amount: String(10000 + n) } }, { mint: s.mint, owner: bot, uiTokenAmount: { amount: "0" } }],
    },
  });
  for (let i = 1; i <= 8; i += 1) s.state.transactions[`a${i}`] = arb(100 * i);
  s.state.signatures[s.pool] = ["a1", "a2", "a3", "a4", "a5", "a6", "s4"]; // arbitrage and one wallet buy
  s.state.signatures[s.meteoraPool] = ["a7", "a8"];
  network(s.state);
  const { body } = await run(s.mint);
  const sells = find(body, "recent-sells");
  assert.equal(sells.value, "Not enough recent data");
  assert.equal(sells.status, "unavailable");
  assert.match(sells.reason, /^Only 1 of the 9 recent pool transactions read involved a wallet trading this token/);
});

await test("recent sells: a sell found in a small sample is still reported (positive evidence, sample stated); only 'no sells' needs 5 wallet trades", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n, meteora: true });
  const bot = key();
  const arb = { transaction: { message: { accountKeys: [bot, s.pool, s.meteoraPool] } }, meta: { err: null, fee: 5000, preBalances: [1, 1, 1], postBalances: [1, 1, 1],
    preTokenBalances: [{ mint: s.mint, owner: s.pool, uiTokenAmount: { amount: "10000" } }, { mint: s.mint, owner: s.meteoraPool, uiTokenAmount: { amount: "10000" } }],
    postTokenBalances: [{ mint: s.mint, owner: s.pool, uiTokenAmount: { amount: "9900" } }, { mint: s.mint, owner: s.meteoraPool, uiTokenAmount: { amount: "10100" } }] } };
  for (let i = 1; i <= 6; i += 1) s.state.transactions[`b${i}`] = arb;
  s.state.signatures[s.pool] = ["b1", "b2", "b3", "b4", "b5", "b6", "s1"]; // bots, and one real sell
  s.state.signatures[s.meteoraPool] = [];
  network(s.state);
  const sells = find((await run(s.mint)).body, "recent-sells");
  assert.equal(sells.value, "1 successful sell by 1 non-creator wallet in the last 1 wallet trade (from 7 transactions across 2 pools)");
  assert.equal(sells.status, "ok");
});

await test("DEX Screener's sell count is shown as its own third-party line, summed across pairs", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n });
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  // A second pair where this token is the QUOTE side: its "buys" are this token's sells.
  s.state.pairs.push({ dexId: "meteora", pairAddress: key(), baseToken: { address: USDC }, quoteToken: { address: s.mint }, liquidity: { usd: 1_000 }, txns: { h1: { buys: 29, sells: 5 }, h24: { buys: 1_000, sells: 3 } } });
  network(s.state);
  const { body } = await run(s.mint);
  const line = find(body, "dex-sells");
  assert.equal(line.label, "Sells counted by DEX Screener (third-party)");
  assert.equal(line.value, "629 in the last hour, 9,000 in the last 24 hours (across 2 pairs, all wallets)");
  assert.equal(line.status, "ok");
  assert.match(line.why, /third-party .* includes bots and can't tell who sold/);
  const ids = body.sections.find((section) => section.id === "honeypot").items.map((entry) => entry.id);
  assert.deepEqual(ids, ["mechanisms", "sell-simulation", "recent-sells", "dex-sells"]);
});

await test("DEX Screener line: no sells in 24 hours → ⚠️; DEX Screener down or no counts → Unavailable", async () => {
  let s = await scenario({ graduated: true, lpSupply: 0n });
  s.state.pairs[0].txns = { h1: { buys: 3, sells: 0 }, h24: { buys: 40, sells: 0 } };
  network(s.state);
  let line = find((await run(s.mint)).body, "dex-sells");
  assert.equal(line.value, "0 in the last hour, 0 in the last 24 hours (across 1 pair, all wallets)");
  assert.equal(line.status, "warn");
  xray.resetXrayForTests();
  s = await scenario({ graduated: true, lpSupply: 0n, extra: { dexDown: true } });
  network(s.state);
  line = find((await run(s.mint)).body, "dex-sells");
  assert.equal(line.value, "Unavailable");
  assert.match(line.reason, /couldn't be reached/);
  xray.resetXrayForTests();
  s = await scenario({ graduated: true, lpSupply: 0n });
  delete s.state.pairs[0].txns;
  network(s.state);
  line = find((await run(s.mint)).body, "dex-sells");
  assert.equal(line.value, "Unavailable");
  assert.match(line.reason, /no trade counts/);
});

await test("recent sells: transactions that fail to load are retried once (rate limits), in small batches", async () => {
  const s = await scenario({ extra: { flaky: new Set(["s1", "s2"]) } });
  const calls = network(s.state);
  const { body } = await run(s.mint);
  assert.equal(find(body, "recent-sells").value, "2 successful sells by 2 non-creator wallets in the last 5 wallet trades (from 5 transactions across 1 pool)");
  assert.equal(calls.filter((method) => method === "getTransaction").length, 7, "5 reads + 2 retries");
});

// ---- Signal launches, unavailable data ---------------------------------------------------------------
await test("a token in Signal's registry gets an extra line: 'Registered on Signal', never 'launched' (the registry can't tell)", async () => {
  const s = await scenario({ extra: { signalToken: { creatorWalletAddress: "x" } } });
  network(s.state);
  const { body } = await run(s.mint);
  const line = find(body, "signal-registered");
  assert.equal(line.label, "Registered on Signal");
  assert.equal(line.value, "Yes (mint authority revoked)");
  assert.equal(line.status, "ok");
  assert.equal(body.sections[0].items[0].id, "signal-registered", "shown first");
  assert.doesNotMatch(JSON.stringify(body), /Launched on Signal|revoked at launch/);
});

await test("unreachable sources say Unavailable (never a guess) and are cached only briefly", async () => {
  const s = await scenario({ graduated: true, extra: { dexDown: true, largestError: true, signalDown: true } });
  network(s.state);
  const { status, body, ttl } = await run(s.mint);
  assert.equal(status, 200);
  for (const id of ["top10", "market", "liquidity", "pool-age", "lp", "signal-registered"]) {
    assert.equal(find(body, id).value, "Unavailable", id);
    assert.equal(find(body, id).status, "unavailable", id);
  }
  assert.equal(find(body, "mint-authority").value, "Revoked", "on-chain facts still shown");
  assert.equal(ttl, xray.CACHE_TTL_MS.partial);
});

await test("not a mint → 404; RPC down → 502; Unavailable isn't a failure", async () => {
  const s = await scenario();
  s.state.accounts[s.mint] = { owner: SYSTEM, data: new Uint8Array(0) };
  network(s.state);
  assert.equal((await run(s.mint)).status, 404);
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal((await run(s.mint)).status, 502);
});

// ---- cost ---------------------------------------------------------------------------------------------
await test("usage is reported per X-Ray (the Helius/RPC cost of an uncached lookup)", async () => {
  const s = await scenario({ graduated: true, lpSupply: 0n });
  network(s.state);
  const { body } = await run(s.mint);
  assert.deepEqual(body.usage.rpcByMethod, { getMultipleAccounts: 3, getTokenLargestAccounts: 2, getTokenSupply: 1, simulateTransaction: 1, getSignaturesForAddress: 1, getTransaction: 5 });
  assert.equal(body.usage.rpcCalls, 13);
  assert.equal(body.usage.jupiterRequests, 1);
  assert.equal(body.usage.dexScreenerRequests, 1);
  assert.equal(body.usage.signalApiRequests, 1);
  assert.ok(xray.RECENT_TRANSACTIONS <= 15, "at most 15 transactions read per X-Ray");
});

// ---- HTTP: validation, cache, rate limit ----------------------------------------------------------------
const get = (mint, ip = "203.0.113.9", now = NOW) => xray.onRequestGet({ request: new Request(`https://signal.test/api/xray?mint=${mint}`, { headers: { "cf-connecting-ip": ip } }), env, now });

await test("GET /api/xray: invalid mint → 400 before any network call", async () => {
  const calls = network({ accounts: {}, largest: {}, supply: {}, signatures: {}, transactions: {} });
  const response = await get("not-a-mint");
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

await test("GET /api/xray: cached per mint for a few minutes (no upstream calls on a repeat)", async () => {
  const s = await scenario();
  const calls = network(s.state);
  const first = await get(s.mint);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control"), /max-age=300/);
  const count = calls.length;
  const second = await get(s.mint, "198.51.100.1", NOW + 60_000);
  assert.equal(second.status, 200);
  assert.equal(calls.length, count, "served from cache");
  await get(s.mint, "198.51.100.1", NOW + xray.CACHE_TTL_MS.full + 1);
  assert.ok(calls.length > count, "refreshed after the cache time");
});

await test("GET /api/xray: uncached lookups are rate-limited per IP (429); other IPs unaffected", async () => {
  const s = await scenario();
  network(s.state);
  const mints = [];
  for (let i = 0; i < xray.RATE_LIMIT.requests + 1; i += 1) mints.push(key());
  for (const mint of mints) s.state.accounts[mint] = { owner: TOKEN, data: mintBytes() };
  for (let i = 0; i < xray.RATE_LIMIT.requests; i += 1) assert.notEqual((await get(mints[i])).status, 429);
  const limited = await get(mints[xray.RATE_LIMIT.requests]);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.notEqual((await get(mints[xray.RATE_LIMIT.requests], "192.0.2.77")).status, 429);
});

await test("the Worker routes GET /api/xray (and refuses other methods)", async () => {
  const worker = (await import("../../../worker.js")).default;
  network({ accounts: {}, largest: {}, supply: {}, signatures: {}, transactions: {} });
  assert.equal((await worker.fetch(new Request("https://signal.test/api/xray?mint=bad"), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://signal.test/api/xray", { method: "POST" }), env)).status, 405);
});

console.log(`\n${passed} passed.`);
