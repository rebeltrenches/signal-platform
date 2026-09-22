import BN from 'bn.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { CurveCalculator, FeeOn, Raydium, TxVersion, getPdaObservationId, makeSwapCpmmBaseInInstruction } from '@raydium-io/raydium-sdk-v2';
import { WRAPPED_SOL_MINT } from './sol-sell-accounts.js';
import type { RaydiumPoolReader, RaydiumSwapBuilder, PoolReserves } from './RaydiumDexAdapter.js';

const MAINNET_CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

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

  constructor(
    private readonly raydium: Raydium,
    private readonly cpmmProgramId: string = MAINNET_CPMM_PROGRAM_ID,
  ) {}

  private async loadPool(poolId: string): Promise<PoolRecord> {
    const cached = this.pools.get(poolId);
    if (cached) return cached;

    const data = await this.raydium.cpmm.getPoolInfoFromRpc(poolId);
    if (data.poolInfo.programId !== this.cpmmProgramId) {
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

    const candidate = (pools as any)?.data?.find((p: any) => p.programId === this.cpmmProgramId);
    if (!candidate?.id) return null;
    return { poolAddress: candidate.id };
  }

  async getReserves(poolAddress: string): Promise<PoolReserves | null> {
    // Force a fresh RPC read for quote-sensitive state.
    this.pools.delete(poolAddress);
    const { poolInfo, rpcData } = await this.loadPool(poolAddress);
    if (!rpcData?.configInfo) return null;

    const feeOnOutput = rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB;
    if (feeOnOutput) {
      throw new Error('Raydium output-side fee pool requires SDK-native quoting; generic SIGNAL quote is disabled.');
    }
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
      feeBps: Math.floor(totalFeeRate / 100),
      liquidityUsd: typeof poolInfo.tvl === 'number' ? poolInfo.tvl : null,
    };
  }


  /**
   * Build a CPMM SELL instruction whose WSOL output goes directly to SIGNAL's
   * fresh trade-specific settlement account. This intentionally uses Raydium's
   * official low-level CPMM instruction builder instead of the convenience
   * swap() path, because the convenience path chooses/unwraps the trader's
   * normal WSOL destination automatically.
   */
  async buildSellSwapToSettlement(params: {
    poolAddress: string;
    traderAddress: string;
    inputToken: string;
    amountIn: bigint;
    minimumWsolOut: bigint;
    settlementWsolAccount: string;
  }): Promise<Transaction> {
    const { poolInfo, poolKeys, rpcData } = await this.loadPool(params.poolAddress);
    if (!poolKeys) throw new Error('Raydium CPMM pool keys are required for settlement-routed SELL.');
    const trader = new PublicKey(params.traderAddress);
    const inputMint = new PublicKey(params.inputToken);
    const settlement = new PublicKey(params.settlementWsolAccount);

    const baseIn = params.inputToken === poolInfo.mintA.address;
    if (!baseIn && params.inputToken !== poolInfo.mintB.address) {
      throw new Error('SELL input mint does not match the Raydium CPMM pool.');
    }
    const outputInfo = baseIn ? poolInfo.mintB : poolInfo.mintA;
    if (outputInfo.address !== WRAPPED_SOL_MINT.toBase58()) {
      throw new Error('SIGNAL creator-fee SELL settlement requires WSOL as the Raydium output mint.');
    }

    const inputInfo = baseIn ? poolInfo.mintA : poolInfo.mintB;
    const inputProgram = new PublicKey(inputInfo.programId ?? TOKEN_PROGRAM_ID);
    const outputProgram = new PublicKey(outputInfo.programId ?? TOKEN_PROGRAM_ID);
    if (!outputProgram.equals(TOKEN_PROGRAM_ID)) {
      throw new Error('Canonical WSOL must use the SPL Token program.');
    }
    const userInputAccount = getAssociatedTokenAddressSync(inputMint, trader, false, inputProgram);

    const inputAmount = new BN(params.amountIn.toString());
    const swapResult = CurveCalculator.swapBaseInput(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo.tradeFeeRate,
      rpcData.configInfo.creatorFeeRate,
      rpcData.configInfo.protocolFeeRate,
      rpcData.configInfo.fundFeeRate,
      rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB,
    );
    if (BigInt(swapResult.outputAmount.toString()) < params.minimumWsolOut) {
      throw new Error('Fresh Raydium SELL output is below SIGNAL minimum received.');
    }

    const ix = makeSwapCpmmBaseInInstruction(
      new PublicKey(poolInfo.programId),
      trader,
      new PublicKey(poolKeys.authority),
      new PublicKey(poolKeys.config.id),
      new PublicKey(poolInfo.id),
      userInputAccount,
      settlement,
      new PublicKey(poolKeys.vault[baseIn ? 'A' : 'B']),
      new PublicKey(poolKeys.vault[baseIn ? 'B' : 'A']),
      inputProgram,
      outputProgram,
      inputMint,
      WRAPPED_SOL_MINT,
      getPdaObservationId(new PublicKey(poolInfo.programId), new PublicKey(poolInfo.id)).publicKey,
      inputAmount,
      new BN(params.minimumWsolOut.toString()),
    );

    return new Transaction().add(ix);
  }

  async buildSwapInstruction(params: {
    poolAddress: string;
    walletAddress: string;
    inputToken: string;
    outputToken: string;
    amountIn: bigint;
    minimumAmountOut: bigint;
  }): Promise<unknown> {
    const { poolInfo, poolKeys, rpcData } = await this.loadPool(params.poolAddress);
    void new PublicKey(params.walletAddress);

    const baseIn = params.inputToken === poolInfo.mintA.address;
    if (!baseIn && params.inputToken !== poolInfo.mintB.address) {
      throw new Error('Input mint does not match the resolved Raydium CPMM pool.');
    }

    const inputAmount = new BN(params.amountIn.toString());
    const swapResult = CurveCalculator.swapBaseInput(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo.tradeFeeRate,
      rpcData.configInfo.creatorFeeRate,
      rpcData.configInfo.protocolFeeRate,
      rpcData.configInfo.fundFeeRate,
      rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB
    );

    if (BigInt(swapResult.outputAmount.toString()) < params.minimumAmountOut) {
      throw new Error('Fresh Raydium output is below SIGNAL minimum received.');
    }

    const { transaction } = await this.raydium.cpmm.swap({
      poolInfo,
      poolKeys,
      inputAmount,
      swapResult,
      slippage: 0,
      baseIn,
      txVersion: TxVersion.V0,
    });

    return transaction;
  }
}
