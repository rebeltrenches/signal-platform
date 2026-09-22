import assert from 'node:assert/strict';
import { getWalletProjectHistoryRoute } from '../src/routes/wallets.js';

function request(chain: string, address: string, depth?: string) {
  return { params: { chain, address }, query: new URLSearchParams(depth === undefined ? '' : `depth=${depth}`) } as any;
}

async function run() {
  const unsupported = await getWalletProjectHistoryRoute(request('ETHEREUM', 'WalletA'));
  assert.equal(unsupported.status, 400);
  const blank = await getWalletProjectHistoryRoute(request('SOLANA', '   '));
  assert.equal(blank.status, 400);
  for (const depth of ['0', '7', '1.5', 'abc']) {
    const response = await getWalletProjectHistoryRoute(request('SOLANA', 'WalletA', depth));
    assert.equal(response.status, 400);
  }

  const previousStorage = process.env.CHAT_STORAGE;
  process.env.CHAT_STORAGE = 'memory';
  try {
    const unavailable = await getWalletProjectHistoryRoute(request('SOLANA', 'WalletA', '3'));
    assert.equal(unavailable.status, 404);
    assert.match(String((unavailable.body as any).message), /project history storage is not available/i);
  } finally {
    if (previousStorage === undefined) delete process.env.CHAT_STORAGE;
    else process.env.CHAT_STORAGE = previousStorage;
  }

  console.log('  ok  - validates supported chains, address, and depth');
  console.log('  ok  - fails closed when evidence storage is unavailable');
  console.log('\n2 test(s) passed.');
}

run();
