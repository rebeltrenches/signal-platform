import assert from 'node:assert/strict';
import { getWalletFundingAncestryRoute } from '../src/routes/wallets.js';

const request = (chain: string, address: string, depth?: string) => ({
  method: 'GET',
  pathname: '/api/v1/wallets/test',
  params: { chain, address },
  query: new URLSearchParams(depth == null ? '' : `depth=${depth}`),
  body: undefined,
  headers: {},
});

async function run() {
  let result = await getWalletFundingAncestryRoute(request('ETHEREUM', 'abc') as any);
  assert.equal(result.status, 400);
  assert.match(String((result.body as any).message), /SOLANA, BASE, or BNB/);

  result = await getWalletFundingAncestryRoute(request('SOLANA', '   ') as any);
  assert.equal(result.status, 400);
  assert.match(String((result.body as any).message), /wallet address is required/);

  for (const depth of ['0', '7', '1.5', 'abc']) {
    result = await getWalletFundingAncestryRoute(request('SOLANA', 'WalletA', depth) as any);
    assert.equal(result.status, 400);
    assert.match(String((result.body as any).message), /depth must be an integer from 1 to 6/);
  }

  // With database storage intentionally unavailable in this isolated route
  // test, a valid request must fail closed rather than fabricate ancestry.
  const old = process.env.CHAT_STORAGE;
  process.env.CHAT_STORAGE = 'memory';
  result = await getWalletFundingAncestryRoute(request('SOLANA', 'WalletA', '3') as any);
  assert.equal(result.status, 404);
  assert.equal((result.body as any).error, 'NOT_FOUND');
  if (old === undefined) delete process.env.CHAT_STORAGE; else process.env.CHAT_STORAGE = old;

  console.log('  ok  - rejects unsupported chains');
  console.log('  ok  - rejects empty wallet addresses');
  console.log('  ok  - bounds ancestry depth to 1..6');
  console.log('  ok  - valid requests fail closed when evidence storage is unavailable');
  console.log('\n4 test(s) passed.');
}

run().catch((err) => { console.error(err); process.exit(1); });
