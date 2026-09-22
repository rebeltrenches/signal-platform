import assert from 'node:assert/strict';
import { computeTaxSplit, validateTaxConfig, bpsToDisplay, computeLaunchFee, InvalidTaxConfigError } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG, DISABLED_TAX_CONFIG, PROTOCOL_MAX_TAX_BPS, LAUNCH_FEE_BPS, LAUNCH_PRICE_LAMPORTS, type TaxConfig } from '@launchpad/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  - ${name}`); passed++; }
  catch (err) { console.error(`  FAIL - ${name}`); throw err; }
}

console.log('tax.test.ts');

test('1% creator trading fee splits SOL-side amount into 1% creator and 99% net', () => {
  const r = computeTaxSplit(1_000_000_000n, DEFAULT_TAX_CONFIG);
  assert.equal(r.totalTax, 10_000_000n);
  assert.equal(r.creatorTax, 10_000_000n);
  assert.equal(r.netAmount, 990_000_000n);
  assert.equal(r.creatorTax + r.netAmount, r.grossAmount);
});

test('disabled fee config passes the full amount through', () => {
  const r = computeTaxSplit(500n, DISABLED_TAX_CONFIG);
  assert.deepEqual(r, { grossAmount: 500n, totalTax: 0n, creatorTax: 0n, netAmount: 500n });
});

test('fee math preserves every base unit across representative amounts', () => {
  for (const amount of [1n, 3n, 99n, 100n, 101n, 999_999_999_999n]) {
    const r = computeTaxSplit(amount, DEFAULT_TAX_CONFIG);
    assert.equal(r.creatorTax + r.netAmount, r.grossAmount);
  }
});

test('invalid fee configuration fails closed', () => {
  assert.throws(() => validateTaxConfig({ enabled: true, totalBps: -1 }), InvalidTaxConfigError);
  assert.throws(() => validateTaxConfig({ enabled: true, totalBps: PROTOCOL_MAX_TAX_BPS + 1 }), InvalidTaxConfigError);
  assert.throws(() => computeTaxSplit(-1n, DEFAULT_TAX_CONFIG), InvalidTaxConfigError);
});

test('current creator trading fee is exactly 1%', () => {
  assert.equal(DEFAULT_TAX_CONFIG.totalBps, 100);
  assert.equal(bpsToDisplay(DEFAULT_TAX_CONFIG.totalBps), '1.00%');
});

test('launch fee is exactly 1% of the fixed 0.1 SOL basis', () => {
  assert.equal(LAUNCH_FEE_BPS, 100);
  assert.equal(LAUNCH_PRICE_LAMPORTS, 100_000_000n);
  assert.equal(computeLaunchFee(), 1_000_000n);
});

console.log(`\n${passed} test(s) passed.`);
