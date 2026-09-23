/**
 * Tests Pump-reference reserve initialization separately from fee logic.
 * Run with: npx tsx apps/api/tests/pump-curve-config.test.ts
 */
import assert from 'node:assert';
import {
  createPumpStyleSolCurve,
  PUMP_REFERENCE_CURVE,
} from '../src/launches/pumpCurveConfig.js';

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

test('1B / 6-decimal supply reproduces Pump documented reserves exactly', () => {
  const state = createPumpStyleSolCurve(PUMP_REFERENCE_CURVE.tokenTotalSupply);
  assert.equal(state.virtualTokenReserves, 1_073_000_000_000_000n);
  assert.equal(state.virtualQuoteReserves, 30_000_000_000n);
  assert.equal(state.realTokenReserves, 793_100_000_000_000n);
  assert.equal(state.realQuoteReserves, 0n);
  assert.equal(state.tokenTotalSupply, 1_000_000_000_000_000n);
  assert.equal(state.complete, false);
});

test('variable Signal supply preserves Pump token-reserve proportions', () => {
  const supply = 100_000_000_000_000n; // 100M whole tokens at 6 decimals
  const state = createPumpStyleSolCurve(supply);
  assert.equal(state.virtualTokenReserves, 107_300_000_000_000n);
  assert.equal(state.realTokenReserves, 79_310_000_000_000n);
  assert.equal(state.virtualQuoteReserves, 30_000_000_000n);
});

test('initialization rejects zero supply', () => {
  assert.throws(() => createPumpStyleSolCurve(0n), /greater than zero/);
});

console.log(`pump-curve-config: ${passed} tests passed`);
