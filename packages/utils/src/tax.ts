/**
 * Integer-only fee math shared by SIGNAL.
 *
 * The current creator trading fee is 1% of the SOL side of SIGNAL-routed
 * trades and belongs entirely to the token creator. It is not a Token-2022
 * transfer fee. The separate launch fee is 1% of the fixed 0.1 SOL
 * launch-price basis, currently 0.001 SOL, paid to SIGNAL.
 */
import type { TaxConfig, BasisPoints } from '@launchpad/types';
import { PROTOCOL_MAX_TAX_BPS, LAUNCH_FEE_BPS, LAUNCH_PRICE_LAMPORTS } from '@launchpad/types';

export class InvalidTaxConfigError extends Error {}

/**
 * Validates a trading-fee config against the protocol's own rules:
 *   - totalBps must not exceed the protocol maximum
 *   - no negative values
 * No split to validate anymore — there's only one number.
 */
export function validateTaxConfig(config: TaxConfig): void {
  if (!config.enabled) return;

  if (config.totalBps < 0) {
    throw new InvalidTaxConfigError('Trading fee basis points cannot be negative.');
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
 * Splits a SOL-side trade amount into net proceeds + the creator trading fee, in base
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
