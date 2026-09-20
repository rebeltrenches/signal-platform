/**
 * Tests for amm-math.ts using deliberately clean, round numbers chosen
 * so the expected values can be verified by hand precisely — not
 * numbers picked for realism, picked so a human (or I) can check the
 * arithmetic without risking a subtle rounding error in the test
 * itself. Run with: npx tsx packages/dex/tests/amm-math.test.ts
 */
import assert from 'node:assert';
import { computeConstantProductOutput, computePriceImpactPercent, computeSwapEstimate } from '../src/amm-math.js';

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

test('doubling the input-side reserve via a single no-fee trade yields exactly half the output reserve (x*y=k, hand-verifiable)', () => {
  // reserveIn=1000, reserveOut=2000. Adding 1000 exactly doubles
  // reserveIn to 2000. Since x*y=k=2,000,000 must hold, the new
  // reserveOut must be 2,000,000/2000=1000 exactly — so amountOut must
  // be exactly 2000-1000=1000. No rounding anywhere in this case.
  const amountOut = computeConstantProductOutput(1000n, 1000n, 2000n, 0);
  assert.strictEqual(amountOut, 1000n);
});

test('a 10% fee (1000 bps) on a clean 1000-unit input reduces the effective input to exactly 900 before the formula applies', () => {
  // amountInAfterFee = 1000 * 9000/10000 = 900 exactly.
  // reserveIn=900, reserveOut=1800 (2x), amountInAfterFee=900 doubles
  // reserveIn again -> same "halves reserveOut" property -> amountOut=900.
  const amountOut = computeConstantProductOutput(1000n, 900n, 1800n, 1000);
  assert.strictEqual(amountOut, 900n);
});

test('price impact for the doubling case above is exactly 50% (spot price 2 -> execution price 1)', () => {
  // spotPrice = reserveOut/reserveIn = 2000/1000 = 2
  // executionPrice = amountOut/amountIn = 1000/1000 = 1
  // impact = (2-1)/2 = 50%
  const impact = computePriceImpactPercent(1000n, 1000n, 1000n, 2000n);
  assert.strictEqual(impact, 50);
});

test('a genuinely small trade (0.01% of pool reserves) against deep liquidity has near-zero price impact', () => {
  // amountIn chosen as a real proportion of the pool (1/10,000th of
  // reserveIn), not a literal tiny bigint like 1 — at extreme
  // reserve/amountIn ratios, integer division inside
  // computeConstantProductOutput can floor the result enough that a
  // LITERAL amountIn of 1 unit produces a misleadingly large computed
  // "impact" that's actually just rounding, not real economics. This
  // is a genuine precision boundary of bigint-based AMM math at
  // extreme ratios, not something this test should paper over by
  // picking degenerate inputs.
  const reserveIn = 1_000_000_000n;
  const reserveOut = 2_000_000_000n;
  const amountIn = reserveIn / 10_000n; // 100,000 — still tiny relative to the pool, but large enough that rounding doesn't dominate
  const amountOut = computeConstantProductOutput(amountIn, reserveIn, reserveOut, 0);
  const impact = computePriceImpactPercent(amountIn, amountOut, reserveIn, reserveOut);
  assert.ok(impact < 0.1, `expected near-zero impact for a small real trade, got ${impact}`);
});

test('computeSwapEstimate applies slippage correctly on a clean number: 100 bps slippage on amountOut=1000 gives minimumAmountOut=990', () => {
  const estimate = computeSwapEstimate(1000n, 1000n, 2000n, 0, 100);
  assert.strictEqual(estimate.amountOut, 1000n);
  assert.strictEqual(estimate.minimumAmountOut, 990n);
});

test('rejects a zero or negative amountIn rather than silently returning a nonsensical result', () => {
  assert.throws(() => computeConstantProductOutput(0n, 1000n, 1000n, 0), RangeError);
  assert.throws(() => computeConstantProductOutput(-1n, 1000n, 1000n, 0), RangeError);
});

test('rejects zero or negative reserves — a pool that does not exist yet is not the same as a pool with zero liquidity', () => {
  assert.throws(() => computeConstantProductOutput(100n, 0n, 1000n, 0), RangeError);
});

test('rejects a fee of 100% or more', () => {
  assert.throws(() => computeConstantProductOutput(100n, 1000n, 1000n, 10000), RangeError);
});

console.log(`${passed} test(s) passed.`);
