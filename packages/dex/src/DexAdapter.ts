/**
 * DEX abstraction (spec section 4/26). apps/api's routing/quote logic
 * depends only on this — a token's actual venue (Raydium, Orca, a
 * Uniswap-compatible pool, PancakeSwap...) is an implementation detail
 * behind whichever DexAdapter handles that chain+pool.
 */
import type { Chain, TokenAmount } from '@launchpad/types';

export interface Quote {
  dexId: string; // e.g. 'raydium', 'orca', 'uniswap-v3', 'pancakeswap-v2'
  inputAmount: TokenAmount;
  estimatedOutputAmount: TokenAmount;
  priceImpactPercent: number;
  route: string[]; // human-readable hop list, e.g. ['SOL', 'USDC', 'TOKEN']
}

export interface Pool {
  dexId: string;
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  liquidityUsd: number | null; // null, not 0, when liquidity is unknown — see DataPoint pattern
}

export interface DexAdapter {
  readonly chain: Chain;
  readonly dexId: string;

  quote(inputToken: string, outputToken: string, amount: TokenAmount): Promise<Quote>;

  /** Returns an unsigned swap transaction for the user's wallet to sign —
   *  same "never sign server-side" rule as BlockchainAdapter. */
  swap(quote: Quote, walletAddress: string, slippageBps: number): Promise<unknown>;

  getPool(tokenA: string, tokenB: string): Promise<Pool | null>;
  getLiquidity(poolAddress: string): Promise<number | null>;
  getPrice(tokenAddress: string): Promise<number | null>;

  /** Multiple DEX adapters on the same chain get compared here to build
   *  the "Route A / Route B / Route C" comparison in spec section 5.
   *  Returns [] (not fabricated routes) if none are found. */
  getRoutes(inputToken: string, outputToken: string, amount: TokenAmount): Promise<Quote[]>;
}

/**
 * Compares quotes from every registered adapter for a chain and returns
 * them sorted best-output-first. Never invents a route: an empty result
 * means the frontend must render "ROUTING UNAVAILABLE" (spec section 5),
 * not a placeholder route.
 */
export async function compareRoutes(
  adapters: DexAdapter[],
  inputToken: string,
  outputToken: string,
  amount: TokenAmount
): Promise<Quote[]> {
  const results = await Promise.allSettled(
    adapters.map((a) => a.getRoutes(inputToken, outputToken, amount))
  );
  const quotes = results
    .filter((r): r is PromiseFulfilledResult<Quote[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  return quotes.sort((a, b) => {
    // Compare as bigint to avoid float precision issues on large amounts.
    const diff = b.estimatedOutputAmount.raw - a.estimatedOutputAmount.raw;
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
}
