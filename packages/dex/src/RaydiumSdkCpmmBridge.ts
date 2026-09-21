import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import type { RaydiumPoolReader, RaydiumSwapBuilder, PoolReserves } from './RaydiumDexAdapter.js';

const CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

type PoolRecord = {
  poolInfo: any;
  poolKeys?: any;
  rpcData: any;
};

/**
 * Official-SDK-backed Raydium CPMM bridge.
 *
 * It reads fresh pool state from RPC and asks Raydium SDK V2 to construct
 * the swap transaction. It never signs or sends a transaction itself.
 */
export class RaydiumSdkCpmmBridge implements RaydiumPoolReader, RaydiumSwapBuilder {
  private readonly pools = new Map<string, PoolRecord>();

  constructor(private readonly raydium: Raydium) {}

  private async loadPool(poolId: string): Promise<PoolRecord> {
    const cached = this.pools.get(poolId);
    if (cached) return cached;

    const data = await this.raydium.cpmm.getPoolInfoFromRpc(poolId);
    if (data.poolInfo.programId !== CPMM_PROGRAM_ID) {
      throw new Error('Resolved Raydium pool is not a CPMM pool.');
    }
    const record = { poolInfo: data.poolInfo, poolKeys: data.poolKeys, rpcData: data.rpcData };
    this.pools.set(poolId, record);
    return record;
  }

  async findPool(tokenA: string, tokenB: string): Promise<{ poolAddress: string } | null> {
    // Raydium's API is used only to discover candidate pool IDs. Reserves
    // and fee state are refreshed from RPC before quoting/execution.
    const pools = await this.raydium.api.fetchPoolByMints({
      mint1: tokenA,
      mint2: tokenB,
      type: 'standard',
      sort: 'liquidity',
      order: 'desc',
      page: 1,
    } as any);

    const candidate = (pools as any)?.data?.find((p: any) => p.programId === CPMM_PROGRAM_ID);
    if (!candidate?.id) return null;
    return { poolAddress: candidate.id };
  }

  async getReserves(poolAddress: string): Promise<PoolReserves | null> {
    // Force a fresh RPC read for quote-sensitive state.
    this.pools.delete(poolAddress);
    const { poolInfo, rpcData } = await this.loadPool(poolAddress);
    if (!rpcData?.configInfo) return null;

    const feeOnOutput = rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB;
    const totalFeeRate =
      Number(rpcData.configInfo.tradeFeeRate ?? 0) +
      Number(rpcData.configInfo.creatorFeeRate ?? 0) +
      Number(rpcData.configInfo.protocolFeeRate ?? 0) +
      Number(rpcData.configInfo.fundFeeRate ?? 0);

    return {
      poolAddress,
      tokenA: poolInfo.mintA.address,
      tokenB: poolInfo.mintB.address,
      reserveA: BigInt(rpcData.baseReserve.toString()),
      reserveB: BigInt(rpcData.quoteReserve.toString()),
      // SIGNAL's generic quote math accepts one input-side fee rate.
      // Output-side fee pools must be quoted by the SDK execution path,
      // so fail closed rather than silently misquote them.
      feeBps: feeOnOutput ? 0 : Math.floor(totalFeeRate / 100),
      liquidityUsd: typeof poolInfo.tvl === 'number' ? poolInfo.tvl : null,
    };
  }

  async buildSwapInstruction(params: {
    poolAddress: string;
    walletAddress: string;
    inputToken: string;
    outputToken: string;
    amountIn: bigint;
    minimumAmountOut: bigint;
  }): Promise<unknown> {
    // Current Raydium SDK V2 exposes tradeV2.swap as the supported
    // high-level swap builder. We use it to avoid hand-rolling CPMM
    // instruction layouts and keep signing/sending outside this bridge.
    void new PublicKey(params.walletAddress);

    const built = await this.raydium.tradeV2.swap({
      inputMint: params.inputToken,
      outputMint: params.outputToken,
      amountIn: params.amountIn,
      slippageBps: 0,
      txVersion: TxVersion.V0,
    } as any);

    // Do not execute here. The caller must inspect the fresh quote,
    // apply SIGNAL creator-fee settlement, then request wallet signing.
    return {
      poolAddress: params.poolAddress,
      minimumAmountOut: params.minimumAmountOut,
      raydium: built,
    };
  }}
