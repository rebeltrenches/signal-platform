// Display-only market data. No wallet, quote or transaction paths.
const BASE = "https://api.coingecko.com/api/v3";
const FRESH_MS = 120_000;
const MAX_AGE_MS = 300_000;
let cached = null;
let pending = null;
let retryAfter = 0;

function reply(body, status = 200) {
  return Response.json(body, { status, headers: {
    "cache-control": status === 200 && body.fresh ? "public, max-age=0, s-maxage=60" : "no-store",
    "x-content-type-options": "nosniff",
  } });
}

async function upstream(params, env) {
  const headers = { accept: "application/json" };
  if (env.COINGECKO_DEMO_API_KEY) headers["x-cg-demo-api-key"] = env.COINGECKO_DEMO_API_KEY;
  const response = await fetch(`${BASE}/coins/markets?${new URLSearchParams(params)}`, {
    headers, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Market provider unavailable");
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) throw new Error("Invalid market response");
  return data;
}

export function selectTopTen(markets, stablecoins, now = Date.now()) {
  const excluded = new Set(stablecoins.map((coin) => coin.id));
  const seen = new Set();
  // Null market_cap_rank is the provider's marker for non-native duplicates.
  // Filter the list BEFORE checking prices, so missing data cannot silently
  // promote #11 into the top ten.
  const selected = markets.filter((coin) => {
    if (excluded.has(coin.id) || !Number.isInteger(coin.market_cap_rank) || coin.market_cap_rank < 1 || seen.has(coin.id)) return false;
    seen.add(coin.id);
    return true;
  }).sort((a, b) => b.market_cap - a.market_cap).slice(0, 10);
  if (selected.length !== 10) throw new Error("Incomplete top ten");
  const coins = selected.map((coin, index) => {
    const updated = Date.parse(coin.last_updated);
    if (typeof coin.id !== "string" || typeof coin.name !== "string" || typeof coin.symbol !== "string" ||
        !Number.isFinite(coin.current_price) || coin.current_price <= 0 || !Number.isFinite(coin.market_cap) || coin.market_cap <= 0 ||
        !Number.isFinite(updated) || now - updated > MAX_AGE_MS || updated - now > 60_000) throw new Error("Invalid or stale market data");
    return { id: coin.id, name: coin.name, symbol: coin.symbol.toUpperCase(), image: coin.image,
      rank: index + 1, marketCapRank: coin.market_cap_rank, price: coin.current_price,
      change24h: Number.isFinite(coin.price_change_percentage_24h) ? coin.price_change_percentage_24h : null,
      updatedAt: new Date(updated).toISOString() };
  });
  return { coins, updatedAt: new Date(Math.min(...coins.map((coin) => Date.parse(coin.updatedAt)))).toISOString(),
    fetchedAt: new Date(now).toISOString(), source: "CoinGecko", currency: "USD" };
}

function usable(snapshot, now) { return snapshot && now - Date.parse(snapshot.updatedAt) <= MAX_AGE_MS; }
function snapshotReply(snapshot, now, failed = false) {
  return reply({ ...snapshot, fresh: !failed && now - Date.parse(snapshot.updatedAt) <= FRESH_MS,
    delayed: failed || now - Date.parse(snapshot.updatedAt) > FRESH_MS });
}

export async function onRequestGet({ env = {}, now = Date.now() }) {
  if (usable(cached, now) && now - Date.parse(cached.fetchedAt) < 60_000) return snapshotReply(cached, now);
  if (now < retryAfter) {
    return usable(cached, now) ? snapshotReply(cached, now, true) : reply({ error: "Current prices are temporarily unavailable." }, 503);
  }
  try {
    if (!pending) pending = (async () => {
      const params = { vs_currency: "usd", order: "market_cap_desc", per_page: "100", page: "1", sparkline: "false", include_rehypothecated: "false" };
      const [markets, stablecoins] = await Promise.all([
        upstream(params, env),
        upstream({ ...params, category: "stablecoins", per_page: "250" }, env),
      ]);
      const snapshot = selectTopTen(markets, stablecoins, now);
      cached = snapshot;
      return snapshot;
    })().finally(() => { pending = null; });
    return snapshotReply(await pending, now);
  } catch {
    retryAfter = now + 60_000;
    return usable(cached, now) ? snapshotReply(cached, now, true) : reply({ error: "Current prices are temporarily unavailable." }, 503);
  }
}

export function resetForTests() { cached = null; pending = null; retryAfter = 0; }
