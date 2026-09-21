/**
 * Real constant-product AMM math (x*y=k, the standard formula every
 * Raydium/Orca/Uniswap-v2-style pool uses) — this is well-known,
 * verifiable mathematics, not a protocol-specific implementation
 * detail. Kept separate from RaydiumDexAdapter.ts so it can be tested
 * directly against hand-computed values, and reused by any future
 * constant-product-style adapter (Orca's legacy pools use the same
 * formula; Orca's newer Whirlpools use concentrated liquidity instead,
 * which needs different math not implemented here).
 */

export interface SwapEstimate {
  amountOut: bigint;
  priceImpactPercent: number;
  minimumAmountOut: bigint;
}

/**
 * amountIn, reserveIn, reserveOut are all in the same base-unit
 * convention as the rest of this project (bigint, never float, for
 * exactly the reason packages/utils/src/tax.ts's own module exists).
 * feeBps is the pool's own swap fee (e.g. Raydium AMM v4's standard
 * 25 bps) — charged on the input before the constant-product formula
 * applies, matching every real implementation of this formula.
 */
export function computeConstantProductOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number
): bigint {
  // Precision note, found while testing this module: at extreme
  // reserve/amountIn ratios (a trade of literally 1 base unit against
  // billion-unit reserves, for instance), integer division here can
  // floor the true output enough that a DOWNSTREAM price-impact
  // calculation reads as a large percentage that is actually just
  // rounding, not real economic impact. Real token amounts at their
  // actual decimal precision essentially never hit this in practice,
  // but a caller constructing a quote for a genuinely tiny raw amount
  // should be aware the output is floored, not rounded to nearest.
  if (amountIn <= 0n) throw new RangeError('amountIn must be positive.');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new RangeError('Pool reserves must be positive.');
  if (feeBps < 0 || feeBps >= 10000) throw new RangeError('feeBps must be in [0, 10000).');

  const amountInAfterFee = (amountIn * BigInt(10000 - feeBps)) / 10000n;
  // x*y=k: (reserveIn + amountInAfterFee) * (reserveOut - amountOut) = reserveIn * reserveOut
  const numerator = amountInAfterFee * reserveOut;
  const denominator = reserveIn + amountInAfterFee;
  return numerator / denominator;
}

/** Price impact: how much worse the actual execution price is than
 *  the pool's current spot price, as a percentage. 0% for an
 *  infinitesimally small trade against deep liquidity; approaches 100%
 *  as a trade drains a pool. */
export function computePriceImpactPercent(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  // Spot price (output per input unit) scaled to avoid bigint division
  // truncation wiping out small values — 1e9 fixed-point, well within
  // safe Number range for the final percentage this produces.
  const SCALE = 1_000_000_000n;
  const spotPriceScaled = (reserveOut * SCALE) / reserveIn;
  const executionPriceScaled = (amountOut * SCALE) / amountIn;
  if (spotPriceScaled === 0n) return 0;
  const impactScaled = ((spotPriceScaled - executionPriceScaled) * 10000n) / spotPriceScaled;
  return Math.max(0, Number(impactScaled) / 100);
}

export function computeSwapEstimate(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
  slippageBps: number
): SwapEstimate {
  const amountOut = computeConstantProductOutput(amountIn, reserveIn, reserveOut, feeBps);
  const priceImpactPercent = computePriceImpactPercent(amountIn, amountOut, reserveIn, reserveOut);
  const minimumAmountOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
  return { amountOut, priceImpactPercent, minimumAmountOut };
}


/**
 * SIGNAL creator-fee settlement for SOL-denominated trading.
 *
 * The creator fee is 1% of the SOL side of a trade. Keeping this
 * calculation in lamports means the creator receives SOL value and
 * SIGNAL never needs to withhold or later liquidate the project token.
 *
 * BUY: fee is taken from the buyer's SOL input before AMM execution.
 * SELL: fee is taken from the SOL output after AMM execution.
 */
export const SIGNAL_CREATOR_FEE_BPS = 100;

export interface SolCreatorFeeSettlement {
  grossSolLamports: bigint;
  creatorFeeLamports: bigint;
  netSolLamports: bigint;
}

export function computeSolCreatorFee(
  grossSolLamports: bigint,
  feeBps: number = SIGNAL_CREATOR_FEE_BPS
): SolCreatorFeeSettlement {
  if (grossSolLamports < 0n) throw new RangeError('grossSolLamports cannot be negative.');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10000) {
    throw new RangeError('feeBps must be an integer in [0, 10000).');
  }

  const creatorFeeLamports = (grossSolLamports * BigInt(feeBps)) / 10_000n;
  return {
    grossSolLamports,
    creatorFeeLamports,
    netSolLamports: grossSolLamports - creatorFeeLamports,
  };
}


/**
 * Split a SOL-denominated SIGNAL trade into creator fee and swap amount.
 * BUY semantics: gross SOL supplied by the trader is split before the
 * Raydium swap; only netSolLamports is sent into the pool.
 */
export function prepareSolBuySettlement(
  grossSolLamports: bigint,
  feeBps: number = SIGNAL_CREATOR_FEE_BPS
) {
  const split = computeSolCreatorFee(grossSolLamports, feeBps);
  if (split.netSolLamports <= 0n) {
    throw new Error('SOL amount after creator fee must be greater than zero.');
  }
  return {
    grossSolLamports: split.grossSolLamports,
    creatorFeeLamports: split.creatorFeeLamports,
    raydiumInputLamports: split.netSolLamports,
  };
}

/**
 * SELL semantics: Raydium first determines the gross SOL output. SIGNAL
 * then splits that SOL output into creator fee and trader proceeds.
 */
export function prepareSolSellSettlement(
  grossSolOutputLamports: bigint,
  feeBps: number = SIGNAL_CREATOR_FEE_BPS
) {
  const split = computeSolCreatorFee(grossSolOutputLamports, feeBps);
  return {
    grossSolOutputLamports: split.grossSolLamports,
    creatorFeeLamports: split.creatorFeeLamports,
    traderReceivesLamports: split.netSolLamports,
  };
}
