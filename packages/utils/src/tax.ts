/**
 * Transfer fee math. This is the one module every trade and every
 * launch-config form must go through — no other file should compute a
 * fee split by hand.
 *
 * CONFIRMED MODEL (updated — see docs/ARCHITECTURE.md for the full
 * decision history, including the earlier 100%-to-creator model this
 * superseded): 100% of the 1% creator transfer fee on transfers goes to the
 * token creator (getPlatformWalletAddress(), @launchpad/config)
 * — not the token's creator, who now receives 0% of this fee. No
 * holder-rewards pool. No automatic distribution. splitCollectedFee(),
 * which existed to divide an already-collected amount between a
 * creator wallet and a rewards pool, does not exist — there is nothing
 * to split; the entire fee goes to the one creator wallet.
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
import { PROTOCOL_MAX_TAX_BPS, LAUNCH_FEE_BPS } from '@launchpad/types';

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
  /** 100% of totalTax — the token creator, per the confirmed
   *  model. Named `creatorTax` (previously `creatorTax`, when the
   *  entire fee went to the token's creator instead) so call sites and
   *  UI code can label this specifically as "the Signal Fee, which
   *  goes entirely to the token creator" without implying the
   *  creator receives any of it. */
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
 * The separate, one-time Launch Fee: 0% (LAUNCH_FEE_BPS) of the
 * creator's actual real launch/creation payment — the rent-exemption
 * lamports the creator is really paying to create the mint account,
 * never token supply or an assumed market value (neither is a real
 * payment being made). `actualPaymentLamports` should be the exact,
 * live-computed value from the chain at launch time (see
 * SolanaAdapter.ts), not a rounded or assumed figure. Returns the fee
 * amount only, in the same lamports unit — 100% of it goes to the
 * token creator, same as the transfer fee, with no further
 * split.
 */
export function computeLaunchFeeFromPayment(actualPaymentLamports: bigint): bigint {
  if (actualPaymentLamports < 0n) {
    throw new InvalidTaxConfigError('actualPaymentLamports cannot be negative.');
  }
  return (actualPaymentLamports * BigInt(LAUNCH_FEE_BPS)) / 10_000n;
}

/** Basis points as a human string, e.g. 100 -> "1.00%". Display only — never compute with this. */
export function bpsToDisplay(bps: BasisPoints): string {
  return `${(bps / 100).toFixed(2)}%`;
}
