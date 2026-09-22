import assert from 'node:assert/strict';
import { getWalletRelationshipClustersRoute } from '../src/routes/wallets.js';

function request(chain: string, address: string, depth?: string) {
  return {
    params: { chain, address },
    query: new URLSearchParams(depth === undefined ? '' : `depth=${depth}`),
  } as any;
}

async function run() {
  const unsupported = await getWalletRelationshipClustersRoute(request('ETHEREUM', 'WalletA'));
  assert.equal(unsupported.status, 400);
  assert.match(String((unsupported.body as any).message), /SOLANA, BASE, or BNB/);

  const blank = await getWalletRelationshipClustersRoute(request('SOLANA', '   '));
  assert.equal(blank.status, 400);
  assert.match(String((blank.body as any).message), /wallet address is required/i);

  for (const depth of ['0', '7', '1.5', 'abc']) {
    const response = await getWalletRelationshipClustersRoute(request('SOLANA', 'WalletA', depth));
    assert.equal(response.status, 400);
    assert.match(String((response.body as any).message), /integer from 1 to 6/i);
  }

  const previousStorage = process.env.CHAT_STORAGE;
  process.env.CHAT_STORAGE = 'memory';
  try {
    const unavailable = await getWalletRelationshipClustersRoute(request('SOLANA', 'WalletA', '3'));
    assert.equal(unavailable.status, 404);
    assert.equal((unavailable.body as any).error, 'NOT_FOUND');
    assert.match(String((unavailable.body as any).message), /relationship cluster storage is not available/i);
  } finally {
    if (previousStorage === undefined) delete process.env.CHAT_STORAGE;
    else process.env.CHAT_STORAGE = previousStorage;
  }

  console.log('  ok  - rejects unsupported chains');
  console.log('  ok  - requires a wallet address');
  console.log('  ok  - validates cluster depth');
  console.log('  ok  - fails closed when evidence storage is unavailable');
  console.log('\n4 test(s) passed.');
}

run();
