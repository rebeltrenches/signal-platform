import assert from 'node:assert';
import { prepareAtomicSolSellPlan, assertAtomicSolSellExecutionAvailable } from '../src/sol-sell-settlement.js';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAILED: ${name}`); throw err; }
}

test('SELL plan splits actual 1 SOL output 1% creator / 99% trader', () => {
  assert.deepStrictEqual(prepareAtomicSolSellPlan({
    grossSolOutputLamports: 1_000_000_000n,
    creatorAddress: 'creator',
    traderAddress: 'trader',
  }), {
    grossSolOutputLamports: 1_000_000_000n,
    creatorFeeLamports: 10_000_000n,
    traderReceivesLamports: 990_000_000n,
    creatorAddress: 'creator',
    traderAddress: 'trader',
  });
});

test('SELL plan rejects output too small to produce one lamport creator fee', () => {
  assert.throws(() => prepareAtomicSolSellPlan({
    grossSolOutputLamports: 99n,
    creatorAddress: 'creator',
    traderAddress: 'trader',
  }));
});

test('SELL execution remains fail-closed until on-chain WSOL splitter exists', () => {
  assert.throws(() => assertAtomicSolSellExecutionAvailable(), /locked/);
});

console.log(`${passed} test(s) passed.`);
