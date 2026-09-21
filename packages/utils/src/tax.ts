/**
 * Transfer fee math. This is the one module every trade and every
 * launch-config form must go through — no other file should compute a
 * fee split by hand.
 *
 * CONFIRMED MODEL: 100% of the 1% transfer fee on transfers goes to the
 * token creator. No holder-rewards pool and no platform share. There is
 * nothing to split after collection; the entire fee belongs to the creator.
 *
 * This module computes the TRANSFER fee only. The separate, one-time
 * Launch Fee (charged at token creation, calculated from the real
 * rent-exemption payment — see packages/types' LAUNCH_FEE_BPS and
 * SolanaAdapter.ts's buildCreateTokenTransaction) is a different
 * mechanism with a different trigger and a different calculation base;
 * computeLaunchFeeFromPayment below handles that one specifically,
 * kept in this same module since both are "fee math" but clearly
 * separated so the two are never confused for one another.
 *
 * Everything here is integer (bigint) arithmetic. Spec section 46 bans
 * floating point for financial calculations, for a real reason: a naive
 * `amount * 0.01` in JS floats will silently drift on large enough numbers
 * and can be exploited at the rounding edges. bigint + basis points avoids
 * that entire class of bug.
 */
import type { TaxConfig, BasisPoints } from '@launchpad/types';
import { PROTOCOL_MAX_TAX_BPS, LAUNCH_FEE_BPS, LAUNCH_PRICE_LAMPORTS } from '@launchpad/types';

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
  /** 100% of totalTax — the token creator, per the confirmed model. */
  creatorTax: bigint;
  netAmount: bigint;
}

/**
 * Splits a TRADE amount into net proceeds + the Signal Fee, in base
 * units. Under the confirmed model this isn't really a "split" (there's
 * only one destination), but the shape is kept so call sites and UI code
 * have a stable, explicit place to read "how much fee", "how much goes
 * to the token creator" (currently identical to totalTax), and
 * "how much is left" — without hand-rolling percentage math anywhere else.
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

/**
 * One-time SIGNAL launch fee. The fee is 1% of the fixed 0.1 SOL
 * launch-price basis, so today's fee is 0.001 SOL (1,000,000 lamports).
 * It is separate from Solana rent/network costs and is paid to SIGNAL,
 * never to the token creator.
 */
export function computeLaunchFee(): bigint {
  return (LAUNCH_PRICE_LAMPORTS * BigInt(LAUNCH_FEE_BPS)) / 10_000n;
}

/** Basis points as a human string, e.g. 100 -> "1.00%". Display only — never compute with this. */
export function bpsToDisplay(bps: BasisPoints): string {
  return `${(bps / 100).toFixed(2)}%`;
}
