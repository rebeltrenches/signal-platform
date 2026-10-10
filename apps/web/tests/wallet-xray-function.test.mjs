import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { atomicAmount, transactionFacts, runAddressXray, HISTORY_LIMIT } from '../../../functions/api/solana/wallet-xray.js';
import { onRequestGet, resetXrayForTests } from '../../../functions/api/solana/xray.js';
import { encodeAddress } from '../../../functions/api/solana/token-market.js';
const key = n => { const bytes = new Uint8Array(32); bytes[0] = n; bytes[31] = 7; return encodeAddress(bytes); };
const wallet = key(1), peer = key(2), mint = key(3), unrelated = key(4);
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const tx = (failed = false) => ({ blockTime: 1700000000, slot: 100, transaction: { message: { accountKeys: [{ pubkey: wallet }, { pubkey: peer }, { pubkey: unrelated }], instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: wallet, destination: peer, lamports: 500000000 } } }] } }, meta: { err: failed ? { InstructionError: [0, 'error'] } : null, fee: 5000, preBalances: [1000000000, 0, 0], postBalances: [499995000, 500000000, 0], preTokenBalances: [], postTokenBalances: [{ owner: wallet, mint, uiTokenAmount: { amount: '9007199254740993', decimals: 9 } }], innerInstructions: [{ instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: peer, destination: wallet, lamports: 100000000 } } }] }] } });
function network(options = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('dexscreener')) return Response.json(options.prices || []);
    const { method, params } = JSON.parse(init.body); calls.push(method);
    if (options.fail?.includes(method) || (options.partialTokens && method === 'getTokenAccountsByOwner' && params[1].programId !== TOKEN)) throw new Error('offline');
    let result;
    if (method === 'getAccountInfo') result = { value: options.account === undefined ? { owner: SYSTEM, data: ['', 'base64'], executable: false } : options.account };
    if (method === 'getBalance') result = { value: 2500000000 };
    if (method === 'getTokenAccountsByOwner') result = { value: params[1].programId === TOKEN ? ['9007199254740993', '7'].map(amount => ({ account: { data: { parsed: { info: { owner: wallet, mint, state: 'initialized', tokenAmount: { amount, decimals: 9 } } } } } })) : [] };
    if (method === 'getSignaturesForAddress') result = options.signatures || [{ signature: 'a' }, { signature: 'b' }];
    if (method === 'getTransaction') result = options.missingTx ? null : tx(params[0] === 'b');
    return Response.json({ result });
  };
  return calls;
}
let count = 0;
async function test(name, fn) { resetXrayForTests(); await fn(); count++; console.log('ok - ' + name); }
const run = () => runAddressXray(wallet, {}, 1700000100000, () => { throw new Error('wallet called token scanner'); });
await test('exact atomic balances and multiple account aggregation', async () => { network(); const { body } = await run(); assert.equal(body.balanceSol, '2.5'); assert.equal(body.tokens[0].amount, '9007199.254741'); assert.equal(atomicAmount(-5000), '-0.000005'); assert.equal(body.tokens[0].usdValue, null); });
await test('map uses explicit successful transfers, including inner instructions', async () => { network(); const { body } = await run(); assert.equal(body.connections.length, 1); assert.equal(body.connections[0].address, peer); assert.equal(body.connections[0].sentSol, '0.5'); assert.equal(body.connections[0].receivedSol, '0.1'); assert.deepEqual(body.connections[0].signatures, ['a']); assert.equal(body.transactions[1].transfers.length, 0); assert.equal(body.transactions[1].tokenChanges.length, 0); assert.equal(body.transactions[0].tokenChanges[0].amount, '9007199.254740993'); });
await test('co-occurrence and balance deltas alone never imply connections', async () => { const t = tx(); t.transaction.message.instructions = []; t.meta.innerInstructions = []; assert.deepEqual(transactionFacts(t, 'a', wallet).transfers, []); });
await test('balance outage is unavailable, never zero', async () => { network({ fail: ['getBalance'] }); const { body, ttl } = await run(); assert.equal(body.balanceSol, null); assert.equal(body.sections[0].items[0].status, 'unavailable'); assert.equal(ttl, 30000); });
await test('token program outage preserves verified partial holdings', async () => { network({ partialTokens: true }); const { body } = await run(); assert.equal(body.tokenDataComplete, false); assert.equal(body.tokens.length, 1); assert.equal(body.sections[0].items.find(x => x.id === 'portfolio-value').status, 'unavailable'); });
await test('missing transactions mark map and history incomplete', async () => { network({ missingTx: true }); const { body } = await run(); assert.equal(body.history.loaded, 0); assert.equal(body.history.sampleComplete, false); assert.match(body.sections[1].items[0].reason, /incomplete/); });
await test('history is bounded and older history explicitly stated', async () => { const calls = network({ signatures: Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => ({ signature: String(i) })) }); const { body } = await run(); assert.equal(body.history.hasMore, true); assert.equal(body.history.loaded, HISTORY_LIMIT); assert.equal(calls.filter(x => x === 'getTransaction').length, HISTORY_LIMIT); });
await test('history outage is not reported as an empty history', async () => { network({ fail: ['getSignaturesForAddress'] }); const { body } = await run(); assert.equal(body.history.available, false); assert.equal(body.sections[1].items[0].status, 'unavailable'); });
await test('unfunded addresses can be scanned without inventing activity', async () => { network({ account: null, signatures: [] }); assert.equal((await run()).body.kind, 'wallet'); });
await test('token accounts and programs are not mislabeled wallets', async () => { network({ account: { owner: TOKEN, data: { parsed: { type: 'account' } } } }); const result = await run(); assert.equal(result.body.kind, 'account'); assert.equal(result.body.sections[0].items[0].value, 'account'); });
await test('mint addresses delegate to existing token checks and count detection', async () => { network({ account: { owner: TOKEN, data: { parsed: { type: 'mint' } } } }); let called = false; const result = await runAddressXray(mint, {}, 1700000100000, async address => { assert.equal(address, mint); called = true; return { status: 200, body: { usage: { rpcCalls: 4, rpcByMethod: {} } } }; }); assert.ok(called); assert.equal(result.body.kind, 'token'); assert.equal(result.body.usage.rpcCalls, 5); });
await test('detection outages return 502 rather than misclassifying', async () => { network({ fail: ['getAccountInfo'] }); assert.equal((await run()).status, 502); });
await test('prices apply only to base tokens on Solana with positive liquidity', async () => { network({ prices: [{ chainId: 'solana', baseToken: { address: mint, name: 'Test', symbol: 'TEST' }, priceUsd: '1', liquidity: { usd: 10000 } }, { chainId: 'solana', baseToken: { address: mint }, priceUsd: '999', liquidity: { usd: 0 } }] }); const { body } = await run(); assert.equal(body.tokens[0].usdValue, Number(body.tokens[0].amount)); assert.match(body.sections[0].items.find(x => x.id === 'portfolio-value').value, /partial/); });
await test('invalid addresses do not call upstreams', async () => { const calls = network(); const res = await onRequestGet({ request: new Request('https://signal.test/api/xray?address=invalid'), env: {} }); assert.equal(res.status, 400); assert.equal(calls.length, 0); });
await test('unified address results use cache and do not collide with legacy mints', async () => { const calls = network(); const req = new Request('https://signal.test/api/xray?address=' + wallet); const first = await onRequestGet({ request: req, env: {}, now: 1700000100000 }); const body = await first.json(); assert.equal(body.kind, 'wallet'); const total = calls.length; assert.equal((await onRequestGet({ request: req, env: {}, now: 1700000101000 })).status, 200); assert.equal(calls.length, total); writeFileSync('/tmp/wallet-xray-fixture.json', JSON.stringify(body)); });
console.log(count + ' wallet scanner tests passed');
