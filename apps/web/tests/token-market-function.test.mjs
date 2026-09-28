// functions/api/solana/token-market.js with every upstream mocked (RPC,
// Helius DAS, DEX Screener, Jupiter, metadata files) and real account bytes
// from Solana Mainnet (tests/fixtures/pump-bonding-curve.json: a
// Token-2022 pump.fun token, its bonding curve and pump.fun's Global).
//
// Run with: node apps/web/tests/token-market-function.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const source = await readFile("functions/api/solana/token-market.js", "utf8");
const tm = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const fixture = JSON.parse(await readFile("apps/web/tests/fixtures/pump-bonding-curve.json", "utf8"));
const require = createRequire(new URL("../package.json", import.meta.url));
const web3 = require("@solana/web3.js");

let passed = 0;
async function test(name, fn) {
  tm.resetForTests();
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const MINT = fixture.mint;
const HELIUS = "https://mainnet.helius-rpc.test/?api-key=test";
const bytes = (b64) => Buffer.from(b64, "base64");
const curve = bytes(fixture.curveAccount.data);
const u64 = (b, o) => b.readBigUInt64LE(o);
const decimals = bytes(fixture.mintAccount.data)[44];

/** A fake of every upstream the endpoint may call. Records calls. */
function upstream({
  accounts = {},
  dexPairs = [],
  solUsd = 150,
  das = null,
  metadataJson = { image: "https://ipfs.io/ipfs/IMAGE" },
  // host -> HTTP status for metadata files (e.g. { "ipfs.io": 429 })
  metadataStatus = {},
  rpcFails = false,
} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.dexscreener.com/")) {
      calls.push("dexscreener");
      return Response.json(dexPairs);
    }
    if (u.includes("/price/v3")) {
      calls.push("jupiter");
      return solUsd === null ? new Response("down", { status: 503 }) : Response.json({ So11111111111111111111111111111111111111112: { usdPrice: solUsd } });
    }
    if (/^https:\/\/(ipfs\.io|dweb\.link|arweave\.net)\//.test(u)) {
      const host = new URL(u).host;
      calls.push(`metadata-json:${host}`);
      if (metadataStatus[host]) return new Response("nope", { status: metadataStatus[host] });
      return Response.json(metadataJson);
    }
    const body = JSON.parse(init.body);
    calls.push(`${u === HELIUS ? "helius" : "public"}:${body.method}`);
    if (rpcFails) return new Response("err", { status: 500 });
    if (body.method === "getTokenAccounts") return Response.json({ jsonrpc: "2.0", id: 1, result: das ?? { token_accounts: [] } });
    if (body.method === "getMultipleAccounts") {
      const value = body.params[0].map((address) => {
        const account = accounts[address];
        return account ? { owner: account.owner, data: [account.data, "base64"], lamports: 1, executable: false } : null;
      });
      return Response.json({ jsonrpc: "2.0", id: 1, result: { value } });
    }
    return new Response("unexpected", { status: 500 });
  };
  return calls;
}

const pumpAccounts = {
  [MINT]: fixture.mintAccount,
  [fixture.curve]: fixture.curveAccount,
  [fixture.global]: fixture.globalAccount,
};

function get(mint, { ip = "203.0.113.7", env = { SOLANA_RPC_URL: HELIUS }, now } = {}) {
  return tm.onRequestGet({
    request: new Request(`https://signal.example/api/solana/token-market?mint=${encodeURIComponent(mint)}`, { headers: { "cf-connecting-ip": ip } }),
    env,
    ...(now !== undefined && { now }),
  });
}

console.log("token-market-function.test.mjs\n");

// ---- addresses and decoding -------------------------------------------------
await test("program addresses match @solana/web3.js (bonding curve, Metaplex metadata, Global) for 200 mints", async () => {
  const pump = new web3.PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  const meta = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  for (let i = 0; i < 200; i += 1) {
    const mint = web3.Keypair.generate().publicKey;
    const [curvePda] = web3.PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], pump);
    const [metaPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("metadata"), meta.toBuffer(), mint.toBuffer()], meta);
    assert.equal(await tm.findProgramAddress([Buffer.from("bonding-curve"), mint.toBytes()], pump.toBase58()), curvePda.toBase58());
    assert.equal(await tm.findProgramAddress([Buffer.from("metadata"), meta.toBytes(), mint.toBytes()], meta.toBase58()), metaPda.toBase58());
  }
  assert.equal(await tm.findProgramAddress([Buffer.from("global")], pump.toBase58()), fixture.global);
  assert.equal(await tm.findProgramAddress([Buffer.from("bonding-curve"), tm.decodeAddress(MINT)], pump.toBase58()), fixture.curve);
});

await test("addresses: only valid 32-byte base58 is accepted, and round-trips", () => {
  assert.equal(tm.encodeAddress(tm.decodeAddress(MINT)), MINT);
  assert.equal(tm.encodeAddress(tm.decodeAddress("11111111111111111111111111111111")), "11111111111111111111111111111111");
  for (const bad of ["", "abc", "0OIl" + "1".repeat(40), MINT + "x", "1".repeat(45), "<script>"]) {
    assert.equal(tm.decodeAddress(bad), null, bad);
  }
});

await test("decodes the real Token-2022 mint's own metadata extension (newer pump.fun tokens)", () => {
  assert.deepEqual(tm.decodeToken2022Metadata(bytes(fixture.mintAccount.data)), {
    name: "magic 🪄", symbol: "piip", uri: "https://ipfs.io/ipfs/QmbYDbeZ8rKjxsPZktWHtqoYiRydnfSG2ZmvXHCYRyKkHM",
  });
  assert.deepEqual(tm.decodeMint(bytes(fixture.mintAccount.data)), { supply: 2_000_000_000_000_000n, decimals: 6 });
});

await test("decodes the real bonding curve and Global accounts, and refuses other account types", () => {
  assert.deepEqual(tm.decodeBondingCurve(curve), {
    virtualTokenReserves: u64(curve, 8), virtualSolReserves: u64(curve, 16), realTokenReserves: u64(curve, 24),
    realSolReserves: u64(curve, 32), tokenTotalSupply: u64(curve, 40), complete: false,
  });
  assert.deepEqual(tm.decodeGlobal(bytes(fixture.globalAccount.data)), {
    initialVirtualTokenReserves: 1_073_000_000_000_000n, initialRealTokenReserves: 793_100_000_000_000n,
  });
  assert.equal(tm.decodeBondingCurve(bytes(fixture.globalAccount.data)), null);
  assert.equal(tm.decodeGlobal(curve), null);
});

// ---- the bonding-curve path --------------------------------------------------
await test("no DEX pair: real price, market cap (SOL and USD), liquidity and progress from the bonding curve", async () => {
  const calls = upstream({
    accounts: pumpAccounts,
    das: { token_accounts: [
      { owner: "OwnerA", amount: "5" }, { owner: "OwnerA", amount: "7" }, { owner: "OwnerB", amount: "1" }, { owner: "OwnerC", amount: "0" },
    ] },
  });
  const response = await get(MINT);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, "pump.fun bonding curve");

  const priceSol = (Number(u64(curve, 16)) / 1e9) / (Number(u64(curve, 8)) / 10 ** decimals);
  // Market cap uses the mint's real on-chain supply (2B here), not the curve's 1B.
  const supply = Number(bytes(fixture.mintAccount.data).readBigUInt64LE(36)) / 10 ** decimals;
  assert.equal(supply, 2_000_000_000);
  assert.deepEqual(body.supply, { value: 2_000_000_000, unit: "tokens" });
  assert.deepEqual(body.price, { sol: { value: priceSol, unit: "SOL" }, usd: { value: priceSol * 150, unit: "USD" } });
  assert.deepEqual(body.marketCap, { sol: { value: priceSol * supply, unit: "SOL" }, usd: { value: priceSol * supply * 150, unit: "USD" } });
  const liquidity = Number(u64(curve, 32)) / 1e9;
  assert.deepEqual(body.liquidity, { sol: { value: liquidity, unit: "SOL" }, usd: { value: liquidity * 150, unit: "USD" } });
  const progress = (Number(793_100_000_000_000n - u64(curve, 24)) / 793_100_000_000_000) * 100;
  assert.deepEqual(body.curveProgress, { value: progress, unit: "%" });

  assert.deepEqual(body.holders, { count: 2, capped: false, source: "Helius" }, "distinct owners with a balance");
  assert.deepEqual(body.logo, { url: "https://ipfs.io/ipfs/IMAGE", source: "on-chain metadata" });
  assert.equal(body.name, "magic 🪄");
  // One account read for mint+curve+Metaplex, one for Global, one DAS page.
  assert.deepEqual(calls.filter((c) => /^(helius|public):/.test(c)).sort(), ["helius:getMultipleAccounts", "helius:getMultipleAccounts", "helius:getTokenAccounts"].sort());
});

await test("a full DAS page is reported as an exact lower bound (N+), never extrapolated", async () => {
  const accounts = Array.from({ length: 1000 }, (_, i) => ({ owner: `Owner${i}`, amount: "1" }));
  upstream({ accounts: pumpAccounts, das: { token_accounts: accounts } });
  const body = await (await get(MINT)).json();
  assert.deepEqual(body.holders, { count: 1000, capped: true, source: "Helius" });
});

await test("without the Helius RPC, holders are Unavailable with the reason (no DAS call to public RPCs)", async () => {
  const calls = upstream({ accounts: pumpAccounts });
  const body = await (await get(MINT, { env: {} })).json();
  assert.match(body.holders.unavailable, /Helius RPC/);
  assert.ok(!calls.some((c) => c.endsWith("getTokenAccounts")));
  assert.equal(body.source, "pump.fun bonding curve", "curve data still comes from public RPCs");
});

await test("without a live SOL price, USD values are Unavailable with the reason; SOL values stay real", async () => {
  upstream({ accounts: pumpAccounts, solUsd: null });
  const body = await (await get(MINT)).json();
  assert.equal(body.price.sol.unit, "SOL");
  assert.match(body.price.usd.unavailable, /SOL\/USD/);
  assert.match(body.marketCap.usd.unavailable, /SOL\/USD/);
});

await test("a completed curve with no DEX pair yet is Unavailable with the reason, not guessed", async () => {
  // (only the curve listing, which is not a DEX pair)
  const done = Buffer.from(curve);
  done[48] = 1;
  upstream({ accounts: { ...pumpAccounts, [fixture.curve]: { ...fixture.curveAccount, data: done.toString("base64") } } });
  const body = await (await get(MINT)).json();
  assert.equal(body.source, null);
  assert.match(body.price.usd.unavailable, /bonding curve is complete/);
});

// ---- the DEX path ------------------------------------------------------------
const SOL = "So11111111111111111111111111111111111111112";
// DEX Screener's listing of the bonding curve itself: no liquidity data.
const curveListing = { dexId: "pumpfun", baseToken: { address: MINT }, quoteToken: { address: SOL }, priceUsd: "0.000003", priceNative: "0.00000003", marketCap: 3754, info: { imageUrl: "https://cdn.dexscreener.test/token.png" } };
const graduated = () => {
  const done = Buffer.from(curve);
  done[48] = 1;
  return { ...pumpAccounts, [fixture.curve]: { ...fixture.curveAccount, data: done.toString("base64") } };
};

await test("while the curve is active it is used, even when DEX Screener lists the curve as a 'pumpfun' pair", async () => {
  upstream({ accounts: pumpAccounts, dexPairs: [curveListing] });
  const body = await (await get(MINT)).json();
  assert.equal(body.source, "pump.fun bonding curve");
  assert.equal(body.liquidity.sol.unit, "SOL", "liquidity comes from the curve, which DEX Screener's listing lacks");
  assert.equal(body.curveProgress.unit, "%");
});

await test("after the curve completes, the deepest real DEX pair is used (never the curve listing), without Jupiter", async () => {
  const calls = upstream({
    accounts: graduated(),
    dexPairs: [
      { ...curveListing, liquidity: { usd: 9_999_999 } },
      { dexId: "raydium", baseToken: { address: MINT }, quoteToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.01", priceNative: "0.0001", marketCap: 10_000_000, liquidity: { usd: 500, quote: 2 } },
      { dexId: "pumpswap", baseToken: { address: MINT }, quoteToken: { address: "So11111111111111111111111111111111111111112" }, priceUsd: "0.02", priceNative: "0.0002", marketCap: 20_000_000, liquidity: { usd: 90_000, quote: 300 } },
    ],
  });
  const body = await (await get(MINT)).json();
  assert.equal(body.source, "DEX Screener (pumpswap)");
  assert.deepEqual(body.price, { sol: { value: 0.0002, unit: "SOL" }, usd: { value: 0.02, unit: "USD" } });
  assert.deepEqual(body.marketCap.usd, { value: 20_000_000, unit: "USD" });
  assert.deepEqual(body.liquidity, { sol: { value: 300, unit: "SOL" }, usd: { value: 90_000, unit: "USD" } });
  assert.match(body.curveProgress.unavailable, /DEX/);
  assert.ok(!calls.includes("jupiter"));
});

// ---- logo ----------------------------------------------------------------------
await test("logo: if ipfs.io refuses (429), the same file is read through another IPFS gateway", async () => {
  const calls = upstream({ accounts: pumpAccounts, metadataStatus: { "ipfs.io": 429 } });
  const body = await (await get(MINT)).json();
  assert.deepEqual(body.logo, { url: "https://ipfs.io/ipfs/IMAGE", source: "on-chain metadata" });
  assert.deepEqual(calls.filter((c) => c.startsWith("metadata-json")), ["metadata-json:ipfs.io", "metadata-json:dweb.link"]);
});

await test("logo: if the metadata can't be read at all, DEX Screener's image is used and labelled", async () => {
  upstream({ accounts: pumpAccounts, dexPairs: [curveListing], metadataStatus: { "ipfs.io": 429, "dweb.link": 503 } });
  const body = await (await get(MINT)).json();
  assert.deepEqual(body.logo, { url: "https://cdn.dexscreener.test/token.png", source: "DEX Screener" });
});

await test("logo: a found logo is cached for an hour (no metadata refetch when market data refreshes)", async () => {
  const calls = upstream({ accounts: pumpAccounts });
  const t0 = 2_000_000;
  await get(MINT, { now: t0 });
  await get(MINT, { now: t0 + tm.CACHE_TTL_MS.found + 1 });
  assert.equal(calls.filter((c) => c.startsWith("metadata-json")).length, 1);
});

await test("logo: Metaplex metadata is used for SPL tokens; a non-https image is Unavailable", async () => {
  const splMint = web3.Keypair.generate().publicKey;
  const meta = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const [metaPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("metadata"), meta.toBuffer(), splMint.toBuffer()], meta);
  const mintData = Buffer.alloc(82);
  mintData.writeBigUInt64LE(1_000n, 36);
  mintData[44] = 6;
  const str = (s, size) => { const b = Buffer.alloc(4 + size); b.writeUInt32LE(size, 0); b.write(s, 4); return b; };
  const metaData = Buffer.concat([Buffer.from([4]), Buffer.alloc(64), str("Meta Coin", 32), str("MC", 10), str("https://arweave.net/META", 200), Buffer.alloc(5)]);
  const accounts = {
    [splMint.toBase58()]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: mintData.toString("base64") },
    [metaPda.toBase58()]: { owner: meta.toBase58(), data: metaData.toString("base64") },
  };
  upstream({ accounts, metadataJson: { image: "https://arweave.net/LOGO" } });
  const body = await (await get(splMint.toBase58())).json();
  assert.deepEqual(body.logo, { url: "https://arweave.net/LOGO", source: "on-chain metadata" });
  assert.equal(body.name, "Meta Coin");
  assert.match(body.price.usd.unavailable, /No DEX pair and no pump\.fun bonding curve/);

  tm.resetForTests();
  upstream({ accounts, metadataJson: { image: "javascript:alert(1)" } });
  const bad = await (await get(splMint.toBase58())).json();
  assert.match(bad.logo.unavailable, /https image/);
});

// ---- quota protection ------------------------------------------------------------
await test("an invalid mint is refused with 400 before any network call", async () => {
  const calls = upstream({ accounts: pumpAccounts });
  for (const bad of ["", "not-a-mint", "<img src=x>", MINT + "1"]) {
    const response = await get(bad);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_MINT");
  }
  assert.deepEqual(calls, []);
});

await test("a mint that doesn't exist is 404, and that answer is cached (no repeat lookups)", async () => {
  const calls = upstream({ accounts: {} });
  const missing = web3.Keypair.generate().publicKey.toBase58();
  const first = await get(missing);
  assert.equal(first.status, 404);
  assert.equal((await first.json()).code, "MINT_NOT_FOUND");
  const callsAfterFirst = calls.length;
  for (let i = 0; i < 5; i += 1) assert.equal((await get(missing)).status, 404);
  assert.equal(calls.length, callsAfterFirst, "no upstream calls for the cached 404");
  assert.match(first.headers.get("cache-control"), /max-age=300/);
});

await test("a found token is cached briefly; after the TTL it is looked up again", async () => {
  const calls = upstream({ accounts: pumpAccounts });
  const t0 = 1_000_000;
  await get(MINT, { now: t0 });
  const afterFirst = calls.length;
  await get(MINT, { now: t0 + tm.CACHE_TTL_MS.found - 1 });
  assert.equal(calls.length, afterFirst, "served from cache inside the TTL");
  await get(MINT, { now: t0 + tm.CACHE_TTL_MS.found + 1 });
  assert.ok(calls.length > afterFirst, "refreshed after the TTL");
});

await test("concurrent requests for one mint share a single lookup", async () => {
  const calls = upstream({ accounts: pumpAccounts });
  const responses = await Promise.all(Array.from({ length: 10 }, () => get(MINT)));
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(calls.filter((c) => c === "dexscreener").length, 1);
  assert.equal(calls.filter((c) => c.endsWith("getTokenAccounts")).length, 1);
});

await test("rate limit: an IP gets 20 uncached lookups a minute, then 429; others and cached answers are unaffected", async () => {
  const calls = upstream({ accounts: {} });
  const t0 = 5_000_000;
  const mints = Array.from({ length: tm.RATE_LIMIT.requests + 1 }, () => web3.Keypair.generate().publicKey.toBase58());
  for (const mint of mints.slice(0, tm.RATE_LIMIT.requests)) assert.equal((await get(mint, { now: t0 })).status, 404);
  const callsBefore = calls.length;
  const limited = await get(mints.at(-1), { now: t0 + 1 });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "RATE_LIMITED");
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(calls.length, callsBefore, "a limited request makes no upstream calls");
  assert.equal((await get(mints[0], { now: t0 + 2 })).status, 404, "an already-cached answer is still served");
  assert.equal((await get(mints.at(-1), { now: t0 + 3, ip: "198.51.100.9" })).status, 404, "another IP isn't limited");
  assert.equal((await get(mints.at(-1), { now: t0 + tm.RATE_LIMIT.windowMs + 10 })).status, 404, "the window resets");
});

await test("rate limit: the Cloudflare rate-limiter binding is used when configured", async () => {
  upstream({ accounts: pumpAccounts });
  const keys = [];
  const env = { SOLANA_RPC_URL: HELIUS, TOKEN_MARKET_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  const response = await get(MINT, { env, ip: "192.0.2.44" });
  assert.equal(response.status, 429);
  assert.deepEqual(keys, ["192.0.2.44"]);
});

await test("an RPC outage is a 502 cached briefly, so retries don't hammer the RPC", async () => {
  const calls = upstream({ accounts: pumpAccounts, rpcFails: true });
  const t0 = 9_000_000;
  const first = await get(MINT, { now: t0 });
  assert.equal(first.status, 502);
  const after = calls.length;
  assert.equal((await get(MINT, { now: t0 + 1_000 })).status, 502);
  assert.equal(calls.length, after);
  assert.match(first.headers.get("cache-control"), /max-age=10/);
});

console.log(`\n${passed} passed.`);
