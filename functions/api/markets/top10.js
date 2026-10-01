// Display-only market data. No wallet, quote or transaction paths.
const BASE = "https://api.coingecko.com/api/v3";
const FRESH_MS = 120_000;
const MAX_AGE_MS = 300_000;
let cached = null;
let pending = null;
let retryAfter = 0;
let geckoRetryAfter = 0;
let exclusions = null;
// CoinPaprika's category list omits some legacy ticker IDs (for example
// usdc-usdc vs usdc-usd-coin). These established stablecoin symbols cover
// those aliases; current category membership still catches new stablecoins.
const STABLE_SYMBOLS = new Set(["USDT", "USDC", "DAI", "USDS", "SUSD", "USDE", "SUSDE", "USD1", "PYUSD", "BUSD", "FRAX", "FDUSD", "USDD", "TUSD", "GUSD", "LUSD", "MIM", "USDF", "USDX", "USDP", "RLUSD", "CRVUSD", "USDC.E", "USDT.E"]);
const WRAPPED_SYMBOLS = new Set(["WBTC", "CBBTC", "WETH", "WBETH", "BETH", "STETH", "WSTETH", "RETH", "CBETH", "WEETH", "EZETH", "RSETH", "WSOL", "WBNB", "WAVAX", "WMATIC", "WPOL"]);

function excludedAsset(coin) {
  const symbol = String(coin.symbol).toUpperCase();
  return STABLE_SYMBOLS.has(symbol) || WRAPPED_SYMBOLS.has(symbol) ||
    /\b(wrapped|bridged|staked|stablecoin)\b/i.test(coin.name || '') ||
    /(?:^|\s)(?:[a-z]*USD[a-z0-9]*|[a-z]*EUR[a-z0-9]*)(?:\s|$)/i.test(coin.name || '');
}

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
    headers, signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`MARKET_PROVIDER_HTTP_${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) throw new Error("Invalid market response");
  return data;
}

export function selectTopTen(markets, stablecoins, now = Date.now(), source = "CoinGecko") {
  const maxAge = source === "CoinPaprika" ? 600_000 : MAX_AGE_MS;
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
        !Number.isFinite(updated) || now - updated > maxAge || updated - now > 60_000) throw new Error("Invalid or stale market data");
    return { id: coin.id, name: coin.name, symbol: coin.symbol.toUpperCase(), image: coin.image,
      rank: index + 1, marketCapRank: coin.market_cap_rank, price: coin.current_price,
      change24h: Number.isFinite(coin.price_change_percentage_24h) ? coin.price_change_percentage_24h : null,
      updatedAt: new Date(updated).toISOString() };
  });
  return { coins, updatedAt: new Date(Math.min(...coins.map((coin) => Date.parse(coin.updatedAt)))).toISOString(),
    fetchedAt: new Date(now).toISOString(), source, currency: "USD" };
}

async function paprika(path) {
  const response = await fetch(`https://api.coinpaprika.com/v1/${path}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`MARKET_PROVIDER_HTTP_${response.status}`);
  return response.json();
}

async function paprikaSnapshot(now) {
  const tags = ["stablecoin", "wrapped-token", "liquid-staking-tokens-lst"];
  const excluded = exclusions && now - exclusions.at < 3_600_000
    ? Promise.resolve(exclusions.coins)
    : Promise.all(tags.map((tag) => paprika(`tags/${tag}?additional_fields=coins`))).then((results) => {
      if (results.some((result, i) => result.id !== tags[i] || !Array.isArray(result.coins))) throw new Error("Invalid category response");
      const coins = [...new Set(results.flatMap((result) => result.coins))].map((id) => ({ id }));
      exclusions = { at: now, coins };
      return coins;
    });
  const [tickers, excludedCoins] = await Promise.all([paprika("tickers?quotes=USD"), excluded]);
  if (!Array.isArray(tickers) || !tickers.length) throw new Error("Invalid market response");
  const markets = tickers.map((coin) => ({
    id: coin.id, name: coin.name, symbol: coin.symbol,
    market_cap_rank: excludedAsset(coin) ? null : coin.rank,
    current_price: coin.quotes?.USD?.price, market_cap: coin.quotes?.USD?.market_cap,
    price_change_percentage_24h: coin.quotes?.USD?.percent_change_24h,
    last_updated: coin.last_updated,
    image: `https://static.coinpaprika.com/coin/${encodeURIComponent(coin.id)}/logo.png`,
  }));
  return selectTopTen(markets, excludedCoins, now, "CoinPaprika");
}

async function coinLoreSnapshot(now) {
  const response = await fetch("https://api.coinlore.net/api/tickers/?start=0&limit=100", {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`MARKET_PROVIDER_HTTP_${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.data) || !data.data.length || !Number.isFinite(data.info?.time)) throw new Error("Invalid market response");
  const updatedAt = new Date(data.info.time * 1000).toISOString();
  const number = (value) => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : null;
  const markets = data.data.map((coin) => ({
    id: String(coin.id), name: coin.name, symbol: coin.symbol,
    market_cap_rank: excludedAsset(coin) ? null : number(coin.rank),
    market_cap: number(coin.market_cap_usd), current_price: number(coin.price_usd),
    price_change_percentage_24h: number(coin.percent_change_24h), last_updated: updatedAt,
    image: `https://www.coinlore.com/img/${encodeURIComponent(coin.nameid)}.png`,
  }));
  return selectTopTen(markets, [], now, "CoinLore");
}

function usable(snapshot, now) { return snapshot && now - Date.parse(snapshot.updatedAt) <= (snapshot.source === "CoinPaprika" ? 600_000 : MAX_AGE_MS); }
function snapshotReply(snapshot, now, failed = false) {
  const freshAge = snapshot.source === "CoinPaprika" ? 360_000 : FRESH_MS;
  return reply({ ...snapshot, fresh: !failed && now - Date.parse(snapshot.updatedAt) <= freshAge,
    delayed: failed || now - Date.parse(snapshot.updatedAt) > freshAge });
}

export async function onRequestGet({ env = {}, now = Date.now() }) {
  if (usable(cached, now) && now - Date.parse(cached.fetchedAt) < 60_000) return snapshotReply(cached, now);
  if (now < retryAfter) {
    return usable(cached, now) ? snapshotReply(cached, now, true) : reply({ error: "Current prices are temporarily unavailable." }, 503);
  }
  try {
    if (!pending) pending = (async () => {
      let snapshot;
      if (now >= geckoRetryAfter) {
        try {
          const params = { vs_currency: "usd", order: "market_cap_desc", per_page: "100", page: "1", sparkline: "false", include_rehypothecated: "false" };
          const [markets, stablecoins] = await Promise.all([
            upstream(params, env),
            upstream({ ...params, category: "stablecoins", per_page: "250" }, env),
          ]);
          snapshot = selectTopTen(markets, stablecoins, now);
        } catch (error) {
          // Avoid repeatedly hitting a provider that rejects this server.
          geckoRetryAfter = now + 600_000;
          console.warn('[home-markets] primary provider unavailable', /^MARKET_PROVIDER_HTTP_\d+$/.test(error?.message || '') ? error.message : error?.name || 'Error');
        }
      }
      if (!snapshot) {
        try { snapshot = await coinLoreSnapshot(now); }
        catch { snapshot = await paprikaSnapshot(now); }
      }
      cached = snapshot;
      return snapshot;
    })().finally(() => { pending = null; });
    return snapshotReply(await pending, now);
  } catch (error) {
    const code = /^MARKET_PROVIDER_HTTP_\d+$/.test(error?.message || '') ? error.message
      : error?.name === 'TimeoutError' ? 'MARKET_PROVIDER_TIMEOUT'
      : error?.message === 'Invalid or stale market data' ? 'MARKET_PROVIDER_STALE'
      : 'MARKET_PROVIDER_INVALID';
    console.warn('[home-markets]', code);
    retryAfter = now + 60_000;
    return usable(cached, now) ? snapshotReply(cached, now, true) : reply({ error: "Current prices are temporarily unavailable.", code }, 503);
  }
}

export function resetForTests() { cached = null; pending = null; retryAfter = 0; geckoRetryAfter = 0; exclusions = null; }
