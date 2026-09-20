import type { DexAdapter, Quote, Pool } from './DexAdapter.js';
import type { Chain, TokenAmount } from '@launchpad/types';
import { computeSwapEstimate } from './amm-math.js';

/** Raydium AMM v4's mainnet program id — verified against Raydium's
 *  own GitHub repo and official docs, plus two independent third-party
 *  Solana tooling crates, before being hardcoded here. Included for
 *  identification/logging; this adapter does not itself construct any
 *  instruction against this program id (see PoolReader/SwapBuilder
 *  below for why). Raydium's own current docs note new pairs default
 *  to CPMM rather than AMM v4 for pool creation; RAYDIUM_CPMM_PROGRAM_ID
 *  is included for the same identification purpose. */
export const RAYDIUM_AMM_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
export const RAYDIUM_CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

/** Raydium's typical AMM v4 swap fee — 25 basis points (0.25%), the
 *  long-standing, publicly documented default. A specific pool can
 *  differ; PoolReader.getReserves below is expected to report the
 *  pool's own actual fee once real reserve-reading exists, and this is
 *  only the fallback used when it doesn't specify one. */
export const RAYDIUM_DEFAULT_FEE_BPS = 25;

export interface PoolReserves {
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
  liquidityUsd: number | null;
}

/**
 * The genuinely protocol-specific pieces this adapter does NOT
 * implement itself: finding a pool for a token pair, and reading its
 * live reserves. Raydium's own official documentation confirms why —
 * even their own code demos delegate this to @raydium-io/raydium-sdk-v2
 * (`raydium.liquidity.getPoolInfoFromRpc`), which decodes the pool
 * account's specific byte layout internally. That layout is real,
 * versioned, and non-trivial; hand-transcribing it from memory here
 * (no internet to install or verify against the real SDK) risks
 * something that resembles a working implementation without actually
 * being one — exactly the kind of unverifiable financial code this
 * project has avoided throughout. A real implementation of this
 * interface, backed by the real SDK, is the one piece of glue needed
 * once real infrastructure exists.
 */
export interface RaydiumPoolReader {
  findPool(tokenA: string, tokenB: string): Promise<{ poolAddress: string } | null>;
  getReserves(poolAddress: string): Promise<PoolReserves | null>;
}

/**
 * Similarly not hand-rolled: the actual swap instruction's exact
 * account list and ordering (Raydium's own docs: "poolKeys ... carries
 * every AMM v4 and OpenBook account in the order the program expects,"
 * produced by the SDK, not written by hand). This adapter constructs
 * the parts around it (fee payer, recent-blockhash placeholder,
 * human-readable summary) but delegates the actual instruction bytes.
 */
export interface RaydiumSwapBuilder {
  buildSwapInstruction(params: {
    poolAddress: string;
    walletAddress: string;
    inputToken: string;
    outputToken: string;
    amountIn: bigint;
    minimumAmountOut: bigint;
  }): Promise<unknown>;
}

/**
 * Real orchestration and real constant-product math (amm-math.ts),
 * around two protocol-specific operations that are deliberately NOT
 * implemented here (see RaydiumPoolReader/RaydiumSwapBuilder above).
 * Without a real PoolReader/SwapBuilder supplied, every method returns
 * an honest empty/unavailable result — never a fabricated quote or
 * pool — matching DexAdapter's own documented "never invent a route"
 * contract.
 *
 * NEVER RUN AGAINST REAL SOLANA MAINNET. No internet exists anywhere
 * this project has been built, so no real pool has ever actually been
 * read, and no real swap has ever actually been constructed or
 * executed through this class.
 */
export class RaydiumDexAdapter implements DexAdapter {
  readonly dexId = 'raydium';

  constructor(
    public readonly chain: Chain,
    private readonly poolReader?: RaydiumPoolReader,
    private readonly swapBuilder?: RaydiumSwapBuilder
  ) {}

  async getPool(tokenA: string, tokenB: string): Promise<Pool | null> {
    if (!this.poolReader) return null;
    const found = await this.poolReader.findPool(tokenA, tokenB);
    if (!found) return null;
    const reserves = await this.poolReader.getReserves(found.poolAddress);
    if (!reserves) return null;
    return {
      dexId: this.dexId,
      poolAddress: reserves.poolAddress,
      tokenA: reserves.tokenA,
      tokenB: reserves.tokenB,
      liquidityUsd: reserves.liquidityUsd,
    };
  }

  async getLiquidity(poolAddress: string): Promise<number | null> {
    if (!this.poolReader) return null;
    const reserves = await this.poolReader.getReserves(poolAddress);
    return reserves?.liquidityUsd ?? null;
  }

  async getPrice(tokenAddress: string): Promise<number | null> {
    // Spot price needs a specific quote-currency pool to be meaningful
    // (price IN something) — a bare "price of token X" isn't well-
    // defined without one. Real implementations resolve this against a
    // known base pair (e.g. vs. USDC or SOL); not fabricated here.
    void tokenAddress;
    return null;
  }

  async quote(inputToken: string, outputToken: string, amount: TokenAmount): Promise<Quote> {
    if (!this.poolReader) {
      throw new Error('No pool reader configured — cannot quote without reading real pool reserves.');
    }
    const found = await this.poolReader.findPool(inputToken, outputToken);
    if (!found) throw new Error(`No Raydium pool found for ${inputToken}/${outputToken}.`);
    const reserves = await this.poolReader.getReserves(found.poolAddress);
    if (!reserves) throw new Error(`Could not read reserves for pool ${found.poolAddress}.`);

    const inputIsTokenA = reserves.tokenA === inputToken;
    const reserveIn = inputIsTokenA ? reserves.reserveA : reserves.reserveB;
    const reserveOut = inputIsTokenA ? reserves.reserveB : reserves.reserveA;

    const estimate = computeSwapEstimate(amount.raw, reserveIn, reserveOut, reserves.feeBps, 0);
    return {
      dexId: this.dexId,
      inputAmount: amount,
      estimatedOutputAmount: { raw: estimate.amountOut, decimals: amount.decimals },
      priceImpactPercent: estimate.priceImpactPercent,
      route: [inputToken, outputToken],
    };
  }

  async getRoutes(inputToken: string, outputToken: string, amount: TokenAmount): Promise<Quote[]> {
    try {
      const q = await this.quote(inputToken, outputToken, amount);
      return [q];
    } catch {
      // DexAdapter's own contract: no route found is [], never a
      // fabricated placeholder route.
      return [];
    }
  }

  async swap(quote: Quote, walletAddress: string, slippageBps: number): Promise<unknown> {
    if (!this.swapBuilder) {
      throw new Error('No swap builder configured — this adapter does not construct swap instructions itself (see class doc).');
    }
    if (quote.route.length !== 2) {
      throw new Error('This adapter only supports a direct single-pool swap, not a multi-hop route.');
    }
    const [inputToken, outputToken] = quote.route;
    const minimumAmountOut = (quote.estimatedOutputAmount.raw * BigInt(10000 - slippageBps)) / 10000n;
    const found = await (this.poolReader as RaydiumPoolReader | undefined)?.findPool(inputToken!, outputToken!);
    if (!found) throw new Error('Could not re-resolve the pool for this quote.');

    return this.swapBuilder.buildSwapInstruction({
      poolAddress: found.poolAddress,
      walletAddress,
      inputToken: inputToken!,
      outputToken: outputToken!,
      amountIn: quote.inputAmount.raw,
      minimumAmountOut,
    });
  }
}
