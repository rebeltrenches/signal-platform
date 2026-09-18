/**
 * Transfer fee math. This is the one module every trade and every
 * launch-config form must go through — no other file should compute a
 * fee split by hand.
 *
 * CONFIRMED MODEL (2026-09-17, final state after multiple reversals —
 * see docs/ROADMAP.md Stage 6 for the full history): 100% of the 3%
 * Transfer Fee goes to the token's own creator. No Signal platform fee.
 * No holder-rewards pool. No automatic distribution. splitCollectedFee(),
 * which existed to divide an already-collected amount between a
 * platform wallet and a rewards pool, does not exist — there is nothing
 * to split.
 *
 * Everything here is integer (bigint) arithmetic. Spec section 46 bans
 * floating point for financial calculations, for a real reason: a naive
 * `amount * 0.03` in JS floats will silently drift on large enough numbers
 * and can be exploited at the rounding edges. bigint + basis points avoids
 * that entire class of bug.
 */
import type { TaxConfig, BasisPoints } from '@launchpad/types';
import { PROTOCOL_MAX_TAX_BPS } from '@launchpad/types';

export class InvalidTaxConfigError extends Error {}

/**
 * Validates a transfer-fee config against the protocol's own rules:
 *   - totalBps must not exceed the protocol maximum
 *   - no negative values
 * No split to validate anymore — there's only one number.
 */
export function validateTaxConfig(config: TaxConfig): void {
  if (!config.enabled) return;

  if (config.totalBps < 0) {
    throw new InvalidTaxConfigError('Transfer fee basis points cannot be negative.');
  }
  if (config.totalBps > PROTOCOL_MAX_TAX_BPS) {
    throw new InvalidTaxConfigError(
      `Total transfer fee ${config.totalBps}bps exceeds protocol maximum ${PROTOCOL_MAX_TAX_BPS}bps.`
    );
  }
}

export interface TaxSplit {
  grossAmount: bigint;
  totalTax: bigint;
  /** 100% of totalTax — the token's own creator, per the confirmed
   *  model. Kept as its own named field (rather than only exposing
   *  totalTax) so the UI can label this specifically as "the Transfer
   *  Fee, which goes entirely to the creator." */
  creatorTax: bigint;
  netAmount: bigint;
}

/**
 * Splits a TRADE amount into net proceeds + the Transfer Fee, in base
 * units. Under the confirmed model this isn't really a "split" (there's
 * only one destination), but the shape is kept so call sites and UI code
 * have a stable, explicit place to read "how much fee", "how much goes
 * to the creator" (currently identical), and "how much is left" —
 * without hand-rolling percentage math anywhere else.
 */
export function computeTaxSplit(grossAmount: bigint, config: TaxConfig): TaxSplit {
  if (grossAmount < 0n) {
    throw new InvalidTaxConfigError('grossAmount cannot be negative.');
  }
  validateTaxConfig(config);

  if (!config.enabled || config.totalBps === 0) {
    return { grossAmount, totalTax: 0n, creatorTax: 0n, netAmount: grossAmount };
  }

  const bpsDenominator = 10_000n;
  const totalTax = (grossAmount * BigInt(config.totalBps)) / bpsDenominator;
  const netAmount = grossAmount - totalTax;

  return { grossAmount, totalTax, creatorTax: totalTax, netAmount };
}

/** Basis points as a human string, e.g. 300 -> "3.00%". Display only — never compute with this. */
export function bpsToDisplay(bps: BasisPoints): string {
  return `${(bps / 100).toFixed(2)}%`;
}
