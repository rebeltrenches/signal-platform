import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile('functions/api/markets/top10.js', 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const now = Date.now();
const coin = (id, rank, overrides = {}) => ({ id, name: id, symbol: id, image: '', market_cap_rank: rank,
  market_cap: 1e12 / rank, current_price: 1.23456, price_change_percentage_24h: null,
  last_updated: new Date(now).toISOString(), ...overrides });
const markets = [coin('bitcoin', 1), coin('ethereum', 2), coin('stable', 3),
  coin('wrapped', 4, { market_cap_rank: null }), ...Array.from({ length: 9 }, (_, i) => coin(`coin${i}`, i + 5))];
let passed = 0;
async function test(name, fn) { api.resetForTests(); await fn(); passed++; console.log(`ok ${name}`); }
const get = (time = now) => api.onRequestGet({ now: time });
function mock({ fail = false, data = markets } = {}) {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return fail ? new Response('', { status: 429 }) : Response.json(new URL(url).searchParams.has('category') ? [coin('stable', 3)] : data);
  };
  return () => calls;
}
await test('exactly ten in market cap order; stablecoins and wrapped duplicates excluded', () => {
  const data = api.selectTopTen(markets.slice().reverse(), [coin('stable', 3)], now);
  assert.equal(data.coins.length, 10);
  assert.deepEqual(data.coins.slice(0, 2).map(c => c.id), ['bitcoin', 'ethereum']);
  assert.ok(!data.coins.some(c => ['stable', 'wrapped'].includes(c.id)));
  assert.equal(data.coins[0].change24h, null);
});
await test('missing top coin price fails rather than replacing it with number eleven', () => {
  assert.throws(() => api.selectTopTen([coin('bitcoin', 1, { current_price: null }), ...markets.slice(1)], [coin('stable', 3)], now));
});
await test('rejects old timestamps and future timestamps', () => {
  for (const time of [now - 300001, now + 60001]) assert.throws(() => api.selectTopTen(
    [coin('bitcoin', 1, { last_updated: new Date(time).toISOString() }), ...markets.slice(1)], [coin('stable', 3)], now));
});
await test('successful data cached and concurrent fetches deduplicated', async () => {
  const calls = mock();
  const responses = await Promise.all([get(), get(), get()]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(calls(), 2);
  await get(now + 30000); assert.equal(calls(), 2);
});
await test('outage preserves recent data with delayed label and no caching', async () => {
  mock(); await get(); mock({ fail: true });
  const response = await get(now + 61000); const body = await response.json();
  assert.equal(body.fresh, false); assert.equal(body.delayed, true); assert.equal(body.coins.length, 10);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
await test('expired cached prices are never returned during an outage', async () => {
  mock(); await get(); mock({ fail: true });
  const response = await get(now + 300001); assert.equal(response.status, 503);
  assert.equal((await response.json()).coins, undefined);
});
await test('provider rate limits back off without inventing prices', async () => {
  const calls = mock({ fail: true });
  assert.equal((await get()).status, 503); const firstCalls = calls();
  assert.equal((await get(now + 1000)).status, 503);
  assert.equal(calls(), firstCalls);
});
await test('hosted primary 403 switches to correctly filtered secondary data and source', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('coingecko')) return new Response('', { status: 403 });
    if (String(url).includes('/tags/')) {
      const tag = new URL(url).pathname.split('/').pop();
      return Response.json({ id: tag, coins: tag === 'stablecoin' ? ['stable'] : tag === 'wrapped-token' ? ['wrapped'] : ['staked'] });
    }
    const all = [...markets.filter(c => c.id !== 'wrapped'), coin('wrapped', 4), coin('staked', 4)];
    return Response.json(all.map(c => ({ id:c.id, name:c.name, symbol:c.symbol, rank:c.market_cap_rank,
      last_updated:c.last_updated, quotes:{ USD:{ price:c.current_price, market_cap:c.market_cap, percent_change_24h:c.price_change_percentage_24h } } })));
  };
  const response = await get(); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.source, 'CoinPaprika'); assert.equal(data.coins.length, 10);
  assert.ok(!data.coins.some(c => ['stable','wrapped','staked'].includes(c.id)));
  await get(now + 61000);
  assert.equal(calls.filter(u => u.includes('coingecko')).length, 2);
  assert.equal(calls.filter(u => u.includes('/tags/')).length, 3);
});
await test('secondary timestamps respect its 5 minute feed cadence but expire at 10 minutes', () => {
  const data = markets.map(c => ({...c,last_updated:new Date(now - 301000).toISOString()}));
  assert.equal(api.selectTopTen(data,[coin('stable',3)],now,'CoinPaprika').coins.length,10);
  assert.throws(() => api.selectTopTen(data,[coin('stable',3)],now,'CoinGecko'));
  assert.throws(() => api.selectTopTen(data,[coin('stable',3)],now + 300000,'CoinPaprika'));
});
await test('homepage includes display once; other pages never load its script or CSS', async () => {
  const html = await readFile('apps/web/dist/index.html', 'utf8');
  assert.equal((html.match(/id="home-markets-grid"/g) || []).length, 1);
  assert.ok(html.includes('/client/home-markets.js?v=2'));
  for (const path of ['create', 'explore', 'dashboard', 'security', 'community', 'token/example']) {
    const page = await readFile(`apps/web/dist/${path}/index.html`, 'utf8');
    assert.ok(!page.includes('home-markets'));
  }
});
console.log(`${passed} home market checks passed`);
