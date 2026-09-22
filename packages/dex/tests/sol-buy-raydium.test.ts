import assert from 'node:assert';
import { Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { buildAtomicRaydiumSolBuyWithSlippage } from '../src/sol-buy-raydium.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; } catch (e) { console.error(`FAILED: ${name}`); throw e; } }

async function run() {
  await test('BUY quotes only the 99% Raydium input and applies slippage to token output', async () => {
    const buyer = Keypair.generate().publicKey;
    const creator = Keypair.generate().publicKey;
    let quotedInput = 0n;
    let builtInput = 0n;
    const bridge: any = {
      quoteSwap: async (p: any) => { quotedInput = p.amountIn; return 2_000_000n; },
      buildSwapInstruction: async (p: any) => {
        builtInput = p.amountIn;
        assert.equal(p.minimumAmountOut, 1_980_000n);
        return new Transaction().add(new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1]) }));
      },
    };
    const result = await buildAtomicRaydiumSolBuyWithSlippage({
      bridge, buyerAddress: buyer.toBase58(), creatorAddress: creator.toBase58(),
      poolAddress: Keypair.generate().publicKey.toBase58(), outputToken: Keypair.generate().publicKey.toBase58(),
      grossSolLamports: 1_000_000_000n, slippageBps: 100,
    });
    assert.equal(result.creatorFeeLamports, 10_000_000n);
    assert.equal(result.raydiumInputLamports, 990_000_000n);
    assert.equal(quotedInput, 990_000_000n);
    assert.equal(builtInput, 990_000_000n);
    assert.equal(result.minimumTokenOut, 1_980_000n);
  });

  await test('BUY rejects invalid amount/slippage before quoting', async () => {
    let quoted = false;
    const bridge: any = { quoteSwap: async () => { quoted = true; return 1n; } };
    const base = { bridge, buyerAddress: Keypair.generate().publicKey.toBase58(), creatorAddress: Keypair.generate().publicKey.toBase58(), poolAddress: Keypair.generate().publicKey.toBase58(), outputToken: Keypair.generate().publicKey.toBase58() };
    await assert.rejects(() => buildAtomicRaydiumSolBuyWithSlippage({ ...base, grossSolLamports: 0n, slippageBps: 100 }), /greater than zero/);
    await assert.rejects(() => buildAtomicRaydiumSolBuyWithSlippage({ ...base, grossSolLamports: 1_000n, slippageBps: 10_000 }), /slippageBps/);
    assert.equal(quoted, false);
  });

  console.log(`${passed} test(s) passed.`);
}
run().catch((e) => { console.error(e); process.exit(1); });
