/**
 * Real, runnable tests for the fee module — no framework dependency
 * (this sandbox has no internet to npm-install jest/vitest), just
 * Node's built-in assert. Run with:
 *   npx tsx packages/utils/tests/tax.test.ts
 *
 * CONFIRMED MODEL (updated — see docs/ARCHITECTURE.md for the full
 * decision history): 100% of the 1% Signal Fee on transfers goes to
 * the Signal platform wallet, not the token's creator (who now
 * receives 0% of it). A separate, one-time 1% Launch Fee is charged at
 * creation from the creator's real launch payment (rent lamports) —
 * tested separately below, since it's a distinct mechanism from the
 * transfer fee.
 */
import assert from 'node:assert/strict';
import { computeTaxSplit, validateTaxConfig, bpsToDisplay, computeLaunchFeeFromPayment, InvalidTaxConfigError } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG, DISABLED_TAX_CONFIG, PROTOCOL_MAX_TAX_BPS, LAUNCH_FEE_BPS, type TaxConfig } from '@launchpad/types';

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

test('100 units at default 1% Signal Fee goes entirely to the platform wallet: 1 fee, 99 net', () => {
  const r = computeTaxSplit(100n, DEFAULT_TAX_CONFIG);
  assert.equal(r.totalTax, 1n);
  assert.equal(r.platformTax, 1n);
  assert.equal(r.platformTax, r.totalTax, 'platformTax must equal totalTax — 100%, no split');
  assert.equal(r.netAmount, 99n);
  assert.equal(r.platformTax + r.netAmount, r.grossAmount);
});

test('1000-unit example: 10 Signal Fee, all to the platform wallet, 990 net', () => {
  const r = computeTaxSplit(1000n, DEFAULT_TAX_CONFIG);
  assert.equal(r.totalTax, 10n);
  assert.equal(r.platformTax, 10n);
  assert.equal(r.netAmount, 990n);
});

test('the creator receives none of the Signal Fee — platformTax is the only nonzero destination', () => {
  const r = computeTaxSplit(1_000_000n, DEFAULT_TAX_CONFIG);
  assert.equal(r.platformTax, r.totalTax);
  // There is no creatorTax field at all anymore — confirmed by the
  // exact-keys test further down, not just by absence here.
});

test('disabled config passes everything through with no fee', () => {
  const r = computeTaxSplit(500n, DISABLED_TAX_CONFIG);
  assert.equal(r.totalTax, 0n);
  assert.equal(r.platformTax, 0n);
  assert.equal(r.netAmount, 500n);
});

test('nothing is lost or invented for a range of amounts — platformTax + net == gross, always', () => {
  for (const amount of [1n, 3n, 7n, 11n, 99n, 101n, 999_999_999_999n]) {
    const r = computeTaxSplit(amount, DEFAULT_TAX_CONFIG);
    assert.equal(r.platformTax + r.netAmount, r.grossAmount, `mismatch at amount=${amount}`);
    assert.ok(r.platformTax >= 0n && r.netAmount >= 0n);
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

test('bpsToDisplay formats correctly, including the current 1% default', () => {
  assert.equal(bpsToDisplay(100), '1.00%');
  assert.equal(bpsToDisplay(200), '2.00%');
  assert.equal(bpsToDisplay(1), '0.01%');
});

test('TaxConfig has no creatorBps/platformBps/holderRewardBps fields — confirms no split exists, just one recipient', () => {
  const keys = Object.keys(DEFAULT_TAX_CONFIG);
  assert.deepEqual(keys.sort(), ['enabled', 'totalBps']);
});

test('DEFAULT_TAX_CONFIG.totalBps is exactly 100 (1%), not the old 300 (3%)', () => {
  assert.equal(DEFAULT_TAX_CONFIG.totalBps, 100);
});

// --- Launch Fee: a separate, one-time fee from the transfer fee above ---

test('Launch Fee is 1% (100 bps)', () => {
  assert.equal(LAUNCH_FEE_BPS, 100);
});

test('computeLaunchFeeFromPayment takes 1% of the real payment amount, not supply or an assumed value', () => {
  // A realistic rent-exemption amount, in lamports (~0.002 SOL-ish scale).
  const realRentLamports = 2_000_000n;
  const fee = computeLaunchFeeFromPayment(realRentLamports);
  assert.equal(fee, 20_000n); // exactly 1% of 2,000,000
});

test('computeLaunchFeeFromPayment scales correctly with a clean, hand-verifiable number', () => {
  assert.equal(computeLaunchFeeFromPayment(100n), 1n);
  assert.equal(computeLaunchFeeFromPayment(10_000n), 100n);
});

test('computeLaunchFeeFromPayment rejects a negative payment amount', () => {
  assert.throws(() => computeLaunchFeeFromPayment(-1n), InvalidTaxConfigError);
});

test('computeLaunchFeeFromPayment returns 0 for a 0 payment, never invents a fee from nothing', () => {
  assert.equal(computeLaunchFeeFromPayment(0n), 0n);
});

test('matches the exact example given for this fee: a 1 SOL base launch payment yields a 0.01 SOL (1%) Launch Fee', () => {
  const ONE_SOL_IN_LAMPORTS = 1_000_000_000n;
  const fee = computeLaunchFeeFromPayment(ONE_SOL_IN_LAMPORTS);
  assert.equal(fee, 10_000_000n); // 0.01 SOL, exactly 1% of 1 SOL
});

console.log(`\n${passed} test(s) passed.`);
