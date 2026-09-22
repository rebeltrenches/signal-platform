import { RaydiumSdkCpmmBridge } from './RaydiumSdkCpmmBridge.js';
import { WRAPPED_SOL_MINT } from './sol-sell-accounts.js';
import { assembleSolBuyTransaction } from './sol-trade-transaction.js';

/**
 * Build an unsigned atomic SIGNAL BUY using a fresh Raydium CPMM quote.
 * The gross trader SOL is split first: 1% native SOL to the creator and
 * 99% is the Raydium input. The minimum token output is derived from that
 * net Raydium input, never from the pre-fee gross amount.
 */
export async function buildAtomicRaydiumSolBuyWithSlippage(params: {
  bridge: RaydiumSdkCpmmBridge;
  buyerAddress: string;
  creatorAddress: string;
  poolAddress: string;
  outputToken: string;
  grossSolLamports: bigint;
  slippageBps: number;
}) {
  if (params.grossSolLamports <= 0n) throw new RangeError('BUY gross SOL amount must be greater than zero.');
  if (!Number.isInteger(params.slippageBps) || params.slippageBps < 0 || params.slippageBps >= 10_000) {
    throw new RangeError('BUY slippageBps must be an integer in [0, 10000).');
  }

  // Compute the exact 99% Raydium input before asking Raydium for a quote.
  const preview = assembleSolBuyTransaction({
    buyerAddress: params.buyerAddress,
    creatorAddress: params.creatorAddress,
    grossSolLamports: params.grossSolLamports,
    raydiumTransaction: new (await import('@solana/web3.js')).Transaction(),
  });

  const quotedTokenOut = await params.bridge.quoteSwap({
    poolAddress: params.poolAddress,
    inputToken: WRAPPED_SOL_MINT.toBase58(),
    outputToken: params.outputToken,
    amountIn: preview.raydiumInputLamports,
  });
  const minimumTokenOut = quotedTokenOut * BigInt(10_000 - params.slippageBps) / 10_000n;
  if (minimumTokenOut <= 0n) throw new Error('BUY minimum token output must be greater than zero.');

  const raydiumTransaction = await params.bridge.buildSwapInstruction({
    poolAddress: params.poolAddress,
    walletAddress: params.buyerAddress,
    inputToken: WRAPPED_SOL_MINT.toBase58(),
    outputToken: params.outputToken,
    amountIn: preview.raydiumInputLamports,
    minimumAmountOut: minimumTokenOut,
  });
  if (!(raydiumTransaction instanceof (await import('@solana/web3.js')).Transaction) &&
      !(raydiumTransaction instanceof (await import('@solana/web3.js')).VersionedTransaction)) {
    throw new TypeError('Raydium BUY builder returned an unsupported transaction type.');
  }

  const built = assembleSolBuyTransaction({
    buyerAddress: params.buyerAddress,
    creatorAddress: params.creatorAddress,
    grossSolLamports: params.grossSolLamports,
    raydiumTransaction,
  });
  return { ...built, quotedTokenOut, minimumTokenOut };
}
