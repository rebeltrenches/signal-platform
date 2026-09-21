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
