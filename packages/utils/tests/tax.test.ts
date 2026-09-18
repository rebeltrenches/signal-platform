/**
 * Real, runnable tests for the transfer-fee module — no framework
 * dependency (this sandbox has no internet to npm-install jest/vitest),
 * just Node's built-in assert. Run with:
 *   npx tsx packages/utils/tests/tax.test.ts
 *
 * CONFIRMED MODEL (2026-09-17, final state): 100% of the transfer tax
 * goes to the token's own creator. No platform/holder split.
 */
import assert from 'node:assert/strict';
import { computeTaxSplit, validateTaxConfig, bpsToDisplay, InvalidTaxConfigError } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG, DISABLED_TAX_CONFIG, PROTOCOL_MAX_TAX_BPS, type TaxConfig } from '@launchpad/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL - ${name}`);
    console.log(`         ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('tax.test.ts');

test('100 units at default 3% Transfer Fee goes entirely to the creator: 3 fee, 97 net', () => {
  const r = computeTaxSplit(100n, DEFAULT_TAX_CONFIG);
  assert.equal(r.totalTax, 3n);
  assert.equal(r.creatorTax, 3n);
  assert.equal(r.creatorTax, r.totalTax, 'creatorTax must equal totalTax — 100%, no split');
  assert.equal(r.netAmount, 97n);
  assert.equal(r.creatorTax + r.netAmount, r.grossAmount);
});

test('$1000 example: 30 Transfer Fee, all to the creator, 970 net', () => {
  const r = computeTaxSplit(1000n, DEFAULT_TAX_CONFIG);
  assert.equal(r.totalTax, 30n);
  assert.equal(r.creatorTax, 30n);
  assert.equal(r.netAmount, 970n);
});

test('disabled config passes everything through with no fee', () => {
  const r = computeTaxSplit(500n, DISABLED_TAX_CONFIG);
  assert.equal(r.totalTax, 0n);
  assert.equal(r.creatorTax, 0n);
  assert.equal(r.netAmount, 500n);
});

test('nothing is lost or invented for a range of amounts — creatorTax + net == gross, always', () => {
  for (const amount of [1n, 3n, 7n, 11n, 99n, 101n, 999_999_999_999n]) {
    const r = computeTaxSplit(amount, DEFAULT_TAX_CONFIG);
    assert.equal(r.creatorTax + r.netAmount, r.grossAmount, `mismatch at amount=${amount}`);
    assert.ok(r.creatorTax >= 0n && r.netAmount >= 0n);
  }
});

test('rejects transfer fee above the protocol maximum', () => {
  const bad: TaxConfig = { enabled: true, totalBps: PROTOCOL_MAX_TAX_BPS + 1 };
  assert.throws(() => validateTaxConfig(bad), InvalidTaxConfigError);
});

test('rejects negative basis points', () => {
  const bad: TaxConfig = { enabled: true, totalBps: -50 };
  assert.throws(() => validateTaxConfig(bad), InvalidTaxConfigError);
});

test('rejects a negative trade amount', () => {
  assert.throws(() => computeTaxSplit(-1n, DEFAULT_TAX_CONFIG), InvalidTaxConfigError);
});

test('bpsToDisplay formats correctly', () => {
  assert.equal(bpsToDisplay(300), '3.00%');
  assert.equal(bpsToDisplay(200), '2.00%');
  assert.equal(bpsToDisplay(1), '0.01%');
});

test('TaxConfig has no platformBps/holderRewardBps fields — confirms no split exists', () => {
  const keys = Object.keys(DEFAULT_TAX_CONFIG);
  assert.deepEqual(keys.sort(), ['enabled', 'totalBps']);
});

console.log(`\n${passed} test(s) passed.`);
