import type { PumpCurveState } from './pumpCurveMath.js';
import { PumpCurveMathError } from './pumpCurveMath.js';

/**
 * Pump's current standard SOL-paired curve parameters, expressed in raw
 * base units for its 1B-token / 6-decimal launch.
 *
 * Signal keeps these as reference ratios rather than hard-coding a 1B
 * supply, because Signal explicitly allows any supply >= 100M.
 */
export const PUMP_REFERENCE_CURVE = Object.freeze({
  tokenTotalSupply: 1_000_000_000_000_000n,
  initialVirtualTokenReserves: 1_073_000_000_000_000n,
  initialVirtualQuoteReserves: 30_000_000_000n,
  initialRealTokenReserves: 793_100_000_000_000n,
});

/**
 * Build a Signal SOL curve with Pump's reserve proportions while preserving
 * Signal's creator-selected total supply.
 *
 * Token-side values scale linearly from Pump's documented Global account.
 * Quote-side virtual liquidity stays at Pump's documented 30 SOL starting
 * reserve. This preserves the Pump curve shape/proportions instead of
 * silently forcing Signal tokens to a 1B supply.
 *
 * Rounding is deterministic integer floor division. Any sub-base-unit
 * remainder is intentionally discarded because on-chain token amounts
 * cannot represent fractions of a base unit.
 */
export function createPumpStyleSolCurve(tokenTotalSupply: bigint): PumpCurveState {
  if (tokenTotalSupply <= 0n) {
    throw new PumpCurveMathError('tokenTotalSupply must be greater than zero.');
  }

  const virtualTokenReserves =
    (tokenTotalSupply * PUMP_REFERENCE_CURVE.initialVirtualTokenReserves) /
    PUMP_REFERENCE_CURVE.tokenTotalSupply;
  const realTokenReserves =
    (tokenTotalSupply * PUMP_REFERENCE_CURVE.initialRealTokenReserves) /
    PUMP_REFERENCE_CURVE.tokenTotalSupply;

  if (virtualTokenReserves <= 0n || realTokenReserves <= 0n) {
    throw new PumpCurveMathError('tokenTotalSupply is too small to initialize Pump-style reserves.');
  }

  return {
    virtualTokenReserves,
    virtualQuoteReserves: PUMP_REFERENCE_CURVE.initialVirtualQuoteReserves,
    realTokenReserves,
    realQuoteReserves: 0n,
    tokenTotalSupply,
    complete: false,
  };
}
