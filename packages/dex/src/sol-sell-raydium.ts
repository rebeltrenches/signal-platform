import { RaydiumSdkCpmmBridge } from './RaydiumSdkCpmmBridge.js';
import { deriveSolSellSettlementAccounts } from './sol-sell-accounts.js';
import { assembleAtomicSolSellTransaction } from './sol-sell-transaction.js';

/**
 * Complete unsigned SIGNAL CPMM SELL build:
 * fresh trade settlement account -> Raydium token/WSOL swap -> native SOL split.
 * The caller still must supply a fresh blockhash, simulate, sign and submit.
 */
export async function buildAtomicRaydiumSolSell(params: {
  bridge: RaydiumSdkCpmmBridge;
  settlementProgramId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
  poolAddress: string;
  inputToken: string;
  amountIn: bigint;
  minimumWsolOut: bigint;
}) {
  const accounts = deriveSolSellSettlementAccounts({
    programId: params.settlementProgramId,
    creatorAddress: params.creatorAddress,
    traderAddress: params.traderAddress,
    tradeId: params.tradeId,
  });

  const raydiumTransaction = await params.bridge.buildSellSwapToSettlement({
    poolAddress: params.poolAddress,
    traderAddress: params.traderAddress,
    inputToken: params.inputToken,
    amountIn: params.amountIn,
    minimumWsolOut: params.minimumWsolOut,
    settlementWsolAccount: accounts.settlementWsolAccount.toBase58(),
  });

  return assembleAtomicSolSellTransaction({
    programId: params.settlementProgramId,
    creatorAddress: params.creatorAddress,
    traderAddress: params.traderAddress,
    tradeId: params.tradeId,
    raydiumTransaction,
  });
}

export async function buildAtomicRaydiumSolSellWithSlippage(params: {
  bridge: RaydiumSdkCpmmBridge;
  settlementProgramId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
  poolAddress: string;
  inputToken: string;
  amountIn: bigint;
  slippageBps: number;
}) {
  if (!Number.isInteger(params.slippageBps) || params.slippageBps < 0 || params.slippageBps > 10_000) {
    throw new Error('SELL slippageBps must be an integer between 0 and 10000.');
  }
  const quotedWsolOut = await params.bridge.quoteSellToWsol({
    poolAddress: params.poolAddress,
    inputToken: params.inputToken,
    amountIn: params.amountIn,
  });
  const minimumWsolOut = quotedWsolOut * BigInt(10_000 - params.slippageBps) / 10_000n;
  if (minimumWsolOut <= 0n) throw new Error('SELL minimum WSOL output must be greater than zero.');
  const built = await buildAtomicRaydiumSolSell({ ...params, minimumWsolOut });
  return { ...built, quotedWsolOut, minimumWsolOut };
}
