import { prepareSolSellSettlement } from './amm-math.js';

export interface SolSellSettlementPlan {
  grossSolOutputLamports: bigint;
  creatorFeeLamports: bigint;
  traderReceivesLamports: bigint;
  creatorAddress: string;
  traderAddress: string;
}

/**
 * SELL settlement is intentionally a plan, not a client-side transfer.
 *
 * The 1% creator fee must be calculated from the ACTUAL SOL/WSOL output
 * produced by Raydium. A pre-swap SystemProgram.transfer would charge an
 * estimate and could diverge from execution. The final implementation
 * therefore needs an atomic on-chain settlement instruction/router. Raydium CPMM
 * pays swap output to the user output token account, so merely appending a
 * client-side SOL transfer cannot prove the transfer is based on actual output.
 * SIGNAL must route the WSOL output through a program-controlled settlement
 * account, verify the received delta on-chain, then split it 1%/99% atomically.
 *
 * Until that instruction exists and is verified, SELL execution must
 * remain disabled rather than silently settling from a quote.
 */
export function prepareAtomicSolSellPlan(params: {
  grossSolOutputLamports: bigint;
  creatorAddress: string;
  traderAddress: string;
}): SolSellSettlementPlan {
  if (params.creatorAddress === params.traderAddress) {
    throw new Error('Trader and token creator addresses must be handled explicitly before sell settlement.');
  }

  const settlement = prepareSolSellSettlement(params.grossSolOutputLamports);
  if (settlement.creatorFeeLamports <= 0n) {
    throw new Error('SOL output is too small to produce a creator fee in lamports.');
  }

  return {
    ...settlement,
    creatorAddress: params.creatorAddress,
    traderAddress: params.traderAddress,
  };
}

export function assertAtomicSolSellExecutionAvailable(): never {
  throw new Error(
    'SELL execution is locked until SIGNAL has a verified on-chain WSOL-output splitter that settles from the actual received amount.'
  );
}
