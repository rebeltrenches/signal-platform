/**
 * Deterministic tests for Signal's Pump-style constant-product curve math.
 * Run with: npx tsx apps/api/tests/pump-curve-math.test.ts
 */
import assert from 'node:assert';
import {
  buyExactQuoteIn,
  sellExactTokenIn,
  isPumpCurveComplete,
  PumpCurveMathError,
  type PumpCurveState,
} from '../src/launches/pumpCurveMath.js';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
}

const fresh = (): PumpCurveState => ({
  virtualTokenReserves: 1_073_000_000n,
  virtualQuoteReserves: 30_000_000_000n,
  realTokenReserves: 793_100_000n,
  realQuoteReserves: 0n,
  tokenTotalSupply: 1_000_000_000n,
  complete: false,
});

test('buy follows constant-product virtual-reserve pricing', () => {
  const before = fresh();
  const { tokenAmount, nextState } = buyExactQuoteIn(before, 1_000_000_000n);
  assert(tokenAmount > 0n);
  assert(nextState.virtualTokenReserves < before.virtualTokenReserves);
  assert(nextState.virtualQuoteReserves > before.virtualQuoteReserves);
  assert.equal(nextState.realTokenReserves, before.realTokenReserves - tokenAmount);
  assert(nextState.virtualTokenReserves * nextState.virtualQuoteReserves >= before.virtualTokenReserves * before.virtualQuoteReserves);
});

test('buy then sell moves reserves in opposite directions', () => {
  const bought = buyExactQuoteIn(fresh(), 1_000_000_000n);
  const sellAmount = bought.tokenAmount / 2n;
  const sold = sellExactTokenIn(bought.nextState, sellAmount);
  assert(sold.quoteAmount > 0n);
  assert(sold.nextState.virtualTokenReserves > bought.nextState.virtualTokenReserves);
  assert(sold.nextState.virtualQuoteReserves < bought.nextState.virtualQuoteReserves);
  assert.equal(sold.nextState.realQuoteReserves, bought.nextState.realQuoteReserves - sold.quoteAmount);
});

test('final buy is capped to real inventory and completes curve', () => {
  const state: PumpCurveState = {
    ...fresh(),
    realTokenReserves: 10n,
  };
  const result = buyExactQuoteIn(state, 100_000_000_000n);
  assert.equal(result.tokenAmount, 10n);
  assert.equal(result.nextState.realTokenReserves, 0n);
  assert.equal(result.nextState.complete, true);
  assert.equal(isPumpCurveComplete(result.nextState), true);
});

test('completed curve rejects further bonding-curve trades', () => {
  const state = { ...fresh(), complete: true };
  assert.throws(() => buyExactQuoteIn(state, 1n), PumpCurveMathError);
  assert.throws(() => sellExactTokenIn({ ...state, realQuoteReserves: 1_000n }, 1n), PumpCurveMathError);
});

test('sell cannot pay more quote than the curve really holds', () => {
  const state = { ...fresh(), realQuoteReserves: 1n };
  assert.throws(() => sellExactTokenIn(state, 100_000_000n), /insufficient real quote reserves/);
});

console.log(`pump-curve-math: ${passed} tests passed`);
