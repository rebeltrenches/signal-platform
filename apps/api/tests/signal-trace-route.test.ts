import assert from 'node:assert/strict';
import { getWalletSignalTraceRoute } from '../src/routes/wallets.js';

function request(chain: string, address: string, depth?: string) {
  return {
    params: { chain, address },
    query: new URLSearchParams(depth === undefined ? '' : `depth=${depth}`),
  } as any;
}

async function run() {
  const unsupported = await getWalletSignalTraceRoute(request('ETHEREUM', 'WalletA'));
  assert.equal(unsupported.status, 400);
  assert.match((unsupported.body as any).message, /SOLANA, BASE, or BNB/);

  const blank = await getWalletSignalTraceRoute(request('SOLANA', '   '));
  assert.equal(blank.status, 400);
  assert.match((blank.body as any).message, /wallet address is required/i);

  for (const depth of ['0', '7', '1.5', 'abc']) {
    const invalid = await getWalletSignalTraceRoute(request('SOLANA', 'WalletA', depth));
    assert.equal(invalid.status, 400);
    assert.match((invalid.body as any).message, /depth must be an integer from 1 to 6/i);
  }

  const previousStorage = process.env.CHAT_STORAGE;
  process.env.CHAT_STORAGE = 'memory';
  try {
    const unavailable = await getWalletSignalTraceRoute(request('SOLANA', 'WalletA', '3'));
    assert.equal(unavailable.status, 404);
    assert.equal((unavailable.body as any).error, 'NOT_FOUND');
    assert.match((unavailable.body as any).message, /Signal Trace storage is not available/i);
  } finally {
    if (previousStorage === undefined) delete process.env.CHAT_STORAGE;
    else process.env.CHAT_STORAGE = previousStorage;
  }

  console.log('  ok  - rejects unsupported chains');
  console.log('  ok  - rejects blank wallet addresses');
  console.log('  ok  - validates trace depth bounds');
  console.log('  ok  - fails closed when evidence storage is unavailable');
  console.log('\n4 test(s) passed.');
}

run().catch((err) => { console.error(err); process.exit(1); });
