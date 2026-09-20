/**
 * Tests RaydiumDexAdapter against mocked RaydiumPoolReader/
 * RaydiumSwapBuilder implementations — proves the orchestration and
 * math are correct, NOT that a real Raydium pool on real Solana
 * mainnet behaves this way. No internet exists anywhere this project
 * has been built, so no real pool has ever been read through this
 * class. See RaydiumDexAdapter.ts's own header for this stated
 * precisely.
 *
 * Run with: npx tsx packages/dex/tests/RaydiumDexAdapter.test.ts
 */
import assert from 'node:assert';
import { RaydiumDexAdapter, type RaydiumPoolReader, type RaydiumSwapBuilder, type PoolReserves } from '../src/RaydiumDexAdapter.js';
import { compareRoutes } from '../src/DexAdapter.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
}

const TOKEN_A = 'So11111111111111111111111111111111111111112';
const TOKEN_B = 'SignalTokenMintAddress11111111111111111111';
const POOL_ADDRESS = 'PoolAddress1111111111111111111111111111111';

function mockReader(reserves: PoolReserves | null): RaydiumPoolReader {
  return {
    async findPool() {
      return reserves ? { poolAddress: reserves.poolAddress } : null;
    },
    async getReserves() {
      return reserves;
    },
  };
}

async function run() {
  await test('getPool returns null (never fabricated) when no pool reader is configured', async () => {
    const adapter = new RaydiumDexAdapter('solana' as any);
    const pool = await adapter.getPool(TOKEN_A, TOKEN_B);
    assert.strictEqual(pool, null);
  });

  await test('getPool returns real pool data from the configured reader', async () => {
    const reader = mockReader({
      poolAddress: POOL_ADDRESS, tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1000n, reserveB: 2000n, feeBps: 25, liquidityUsd: 50000,
    });
    const adapter = new RaydiumDexAdapter('solana' as any, reader);
    const pool = await adapter.getPool(TOKEN_A, TOKEN_B);
    assert.strictEqual(pool?.poolAddress, POOL_ADDRESS);
    assert.strictEqual(pool?.liquidityUsd, 50000);
  });

  await test('quote() computes a real output using the actual pool reserves and amm-math, not a fabricated number', async () => {
    const reader = mockReader({
      poolAddress: POOL_ADDRESS, tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1000n, reserveB: 2000n, feeBps: 0, liquidityUsd: 10000,
    });
    const adapter = new RaydiumDexAdapter('solana' as any, reader);
    const quote = await adapter.quote(TOKEN_A, TOKEN_B, { raw: 1000n, decimals: 9 });
    assert.strictEqual(quote.estimatedOutputAmount.raw, 1000n);
    assert.strictEqual(quote.dexId, 'raydium');
    assert.deepStrictEqual(quote.route, [TOKEN_A, TOKEN_B]);
  });

  await test('quote() correctly uses the reversed reserves when swapping tokenB -> tokenA', async () => {
    const reader = mockReader({
      poolAddress: POOL_ADDRESS, tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 2000n, reserveB: 1000n, feeBps: 0, liquidityUsd: 10000,
    });
    const adapter = new RaydiumDexAdapter('solana' as any, reader);
    const quote = await adapter.quote(TOKEN_B, TOKEN_A, { raw: 1000n, decimals: 9 });
    assert.strictEqual(quote.estimatedOutputAmount.raw, 1000n);
  });

  await test('getRoutes returns [] (never a fabricated route) when no pool exists for the pair', async () => {
    const adapter = new RaydiumDexAdapter('solana' as any, mockReader(null));
    const routes = await adapter.getRoutes(TOKEN_A, TOKEN_B, { raw: 1000n, decimals: 9 });
    assert.deepStrictEqual(routes, []);
  });

  await test('swap() throws when no swap builder is configured — never constructs a fake instruction', async () => {
    const reader = mockReader({
      poolAddress: POOL_ADDRESS, tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1000n, reserveB: 2000n, feeBps: 0, liquidityUsd: 10000,
    });
    const adapter = new RaydiumDexAdapter('solana' as any, reader);
    const quote = await adapter.quote(TOKEN_A, TOKEN_B, { raw: 1000n, decimals: 9 });
    await assert.rejects(() => adapter.swap(quote, 'SomeWallet111', 50), /swap builder/);
  });

  await test('swap() calls the real swap builder with a correctly slippage-adjusted minimumAmountOut', async () => {
    const reader = mockReader({
      poolAddress: POOL_ADDRESS, tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1000n, reserveB: 2000n, feeBps: 0, liquidityUsd: 10000,
    });
    let capturedParams: any = null;
    const builder: RaydiumSwapBuilder = {
      async buildSwapInstruction(params) {
        capturedParams = params;
        return { fake: 'instruction' };
      },
    };
    const adapter = new RaydiumDexAdapter('solana' as any, reader, builder);
    const quote = await adapter.quote(TOKEN_A, TOKEN_B, { raw: 1000n, decimals: 9 });
    await adapter.swap(quote, 'WalletXYZ', 100);
    assert.strictEqual(capturedParams.minimumAmountOut, 990n);
    assert.strictEqual(capturedParams.walletAddress, 'WalletXYZ');
    assert.strictEqual(capturedParams.poolAddress, POOL_ADDRESS);
  });

  await test('the existing compareRoutes() correctly integrates with this new adapter and sorts by real output', async () => {
    const goodReader = mockReader({
      poolAddress: 'Pool1', tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1_000_000n, reserveB: 2_000_000n, feeBps: 0, liquidityUsd: 100000,
    });
    const worseReader = mockReader({
      poolAddress: 'Pool2', tokenA: TOKEN_A, tokenB: TOKEN_B,
      reserveA: 1_000_000n, reserveB: 1_500_000n, feeBps: 0, liquidityUsd: 50000,
    });
    const adapterGood = new RaydiumDexAdapter('solana' as any, goodReader);
    const adapterWorse = new RaydiumDexAdapter('solana' as any, worseReader);
    const results = await compareRoutes([adapterWorse, adapterGood], TOKEN_A, TOKEN_B, { raw: 10_000n, decimals: 9 });
    assert.strictEqual(results.length, 2);
    assert.ok(results[0]!.estimatedOutputAmount.raw > results[1]!.estimatedOutputAmount.raw);
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
