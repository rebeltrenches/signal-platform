/**
 * Pump-style constant-product bonding-curve math for Signal.
 *
 * IMPORTANT:
 * - This module contains deterministic reserve math only.
 * - Signal's existing fee model is intentionally NOT implemented here.
 *   Fees are a separate layer so adopting Pump-style pricing cannot
 *   accidentally change Signal's 1% platform fee.
 * - Initial reserve constants are intentionally not invented here.
 *   The caller must supply the launch's configured reserve state.
 * - Graduation is protocol-derived: a curve is complete when its real
 *   token reserves reach zero, matching Pump's documented completion rule.
 */

export interface PumpCurveState {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface PumpCurveBuyQuote {
  tokenAmount: bigint;
  nextState: PumpCurveState;
}

export interface PumpCurveSellQuote {
  quoteAmount: bigint;
  nextState: PumpCurveState;
}

export class PumpCurveMathError extends Error {}

function assertPositive(value: bigint, name: string): void {
  if (value <= 0n) throw new PumpCurveMathError(`${name} must be greater than zero.`);
}

function validateState(state: PumpCurveState): void {
  assertPositive(state.virtualTokenReserves, 'virtualTokenReserves');
  assertPositive(state.virtualQuoteReserves, 'virtualQuoteReserves');
  assertPositive(state.tokenTotalSupply, 'tokenTotalSupply');
  if (state.realTokenReserves < 0n) throw new PumpCurveMathError('realTokenReserves cannot be negative.');
  if (state.realQuoteReserves < 0n) throw new PumpCurveMathError('realQuoteReserves cannot be negative.');
  if (state.realTokenReserves > state.tokenTotalSupply) {
    throw new PumpCurveMathError('realTokenReserves cannot exceed tokenTotalSupply.');
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new PumpCurveMathError('division denominator must be greater than zero.');
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Quote and apply an exact-quote-in buy.
 *
 * x*y=k using virtual reserves:
 *   newVirtualQuote = oldVirtualQuote + quoteIn
 *   newVirtualToken = ceil(k / newVirtualQuote)
 *   tokenOut = oldVirtualToken - newVirtualToken
 *
 * Output is capped by the real tokens actually available. When those real
 * token reserves reach zero, the curve becomes complete and must no longer
 * accept bonding-curve trades.
 */
export function buyExactQuoteIn(state: PumpCurveState, quoteIn: bigint): PumpCurveBuyQuote {
  validateState(state);
  if (state.complete) throw new PumpCurveMathError('Bonding curve is complete.');
  assertPositive(quoteIn, 'quoteIn');
  if (state.realTokenReserves === 0n) throw new PumpCurveMathError('No real token reserves remain.');

  const invariant = state.virtualTokenReserves * state.virtualQuoteReserves;
  const uncappedVirtualQuote = state.virtualQuoteReserves + quoteIn;
  const uncappedVirtualToken = ceilDiv(invariant, uncappedVirtualQuote);
  let tokenAmount = state.virtualTokenReserves - uncappedVirtualToken;

  if (tokenAmount <= 0n) throw new PumpCurveMathError('Trade is too small to produce token output.');
  if (tokenAmount > state.realTokenReserves) tokenAmount = state.realTokenReserves;

  // If the requested quote would buy beyond the remaining real inventory,
  // settle only the quote required for the final available tokens.
  const nextVirtualToken = state.virtualTokenReserves - tokenAmount;
  const nextVirtualQuote = ceilDiv(invariant, nextVirtualToken);
  const quoteUsed = nextVirtualQuote - state.virtualQuoteReserves;

  const nextRealToken = state.realTokenReserves - tokenAmount;
  const nextState: PumpCurveState = {
    ...state,
    virtualTokenReserves: nextVirtualToken,
    virtualQuoteReserves: state.virtualQuoteReserves + quoteUsed,
    realTokenReserves: nextRealToken,
    realQuoteReserves: state.realQuoteReserves + quoteUsed,
    complete: nextRealToken === 0n,
  };

  return { tokenAmount, nextState };
}

/**
 * Quote and apply an exact-token-in sell against the same virtual-reserve
 * invariant. The curve can only pay quote assets that actually exist in its
 * real quote reserve.
 */
export function sellExactTokenIn(state: PumpCurveState, tokenIn: bigint): PumpCurveSellQuote {
  validateState(state);
  if (state.complete) throw new PumpCurveMathError('Bonding curve is complete.');
  assertPositive(tokenIn, 'tokenIn');

  const invariant = state.virtualTokenReserves * state.virtualQuoteReserves;
  const nextVirtualToken = state.virtualTokenReserves + tokenIn;
  const nextVirtualQuote = ceilDiv(invariant, nextVirtualToken);
  const quoteAmount = state.virtualQuoteReserves - nextVirtualQuote;

  if (quoteAmount <= 0n) throw new PumpCurveMathError('Trade is too small to produce quote output.');
  if (quoteAmount > state.realQuoteReserves) {
    throw new PumpCurveMathError('Bonding curve has insufficient real quote reserves for this sell.');
  }

  return {
    quoteAmount,
    nextState: {
      ...state,
      virtualTokenReserves: nextVirtualToken,
      virtualQuoteReserves: nextVirtualQuote,
      realTokenReserves: state.realTokenReserves + tokenIn,
      realQuoteReserves: state.realQuoteReserves - quoteAmount,
    },
  };
}

export function isPumpCurveComplete(state: PumpCurveState): boolean {
  validateState(state);
  return state.complete || state.realTokenReserves === 0n;
}
