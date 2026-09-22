import assert from 'node:assert';
import { Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { buildAtomicRaydiumSolSellWithSlippage } from '../src/sol-sell-raydium.js';
import { deriveSolSellSettlementAccounts } from '../src/sol-sell-accounts.js';

const TRADE_ID = '44'.repeat(32);
const programId = Keypair.generate().publicKey.toBase58();
const creatorAddress = Keypair.generate().publicKey.toBase58();
const traderAddress = Keypair.generate().publicKey.toBase58();
const poolAddress = Keypair.generate().publicKey.toBase58();
const inputToken = Keypair.generate().publicKey.toBase58();

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; }
}

function bridgeWithQuote(quote: bigint) {
  return {
    async quoteSellToWsol() { return quote; },
    async buildSellSwapToSettlement(params: any) {
      const settlement = deriveSolSellSettlementAccounts({
        programId,
        creatorAddress,
        traderAddress,
        tradeId: TRADE_ID,
      }).settlementWsolAccount;
      assert.equal(params.settlementWsolAccount, settlement.toBase58());
      return new Transaction().add(new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [{ pubkey: settlement, isSigner: false, isWritable: true }],
        data: Buffer.from([1]),
      }));
    },
  } as any;
}

async function run() {
await test('SELL derives minimum WSOL output from fresh quote and slippage', async () => {
  const built = await buildAtomicRaydiumSolSellWithSlippage({
    bridge: bridgeWithQuote(1_000_000n),
    settlementProgramId: programId, creatorAddress, traderAddress, tradeId: TRADE_ID,
    poolAddress, inputToken, amountIn: 1_000n, slippageBps: 100,
  });
  assert.equal(built.quotedWsolOut, 1_000_000n);
  assert.equal(built.minimumWsolOut, 990_000n);
});

await test('SELL rejects zero, negative and 100% slippage before quoting', async () => {
  let quoted = false;
  const bridge: any = { quoteSellToWsol: async () => { quoted = true; return 1_000n; } };
  const base = { bridge, settlementProgramId: programId, creatorAddress, traderAddress, tradeId: TRADE_ID, poolAddress, inputToken };
  await assert.rejects(() => buildAtomicRaydiumSolSellWithSlippage({ ...base, amountIn: 0n, slippageBps: 100 }), /greater than zero/);
  await assert.rejects(() => buildAtomicRaydiumSolSellWithSlippage({ ...base, amountIn: -1n, slippageBps: 100 }), /greater than zero/);
  await assert.rejects(() => buildAtomicRaydiumSolSellWithSlippage({ ...base, amountIn: 1n, slippageBps: 10_000 }), /slippageBps/);
  assert.equal(quoted, false);
});

await test('SELL rejects a slippage-adjusted minimum that rounds to zero', async () => {
  await assert.rejects(() => buildAtomicRaydiumSolSellWithSlippage({
    bridge: bridgeWithQuote(1n),
    settlementProgramId: programId, creatorAddress, traderAddress, tradeId: TRADE_ID,
    poolAddress, inputToken, amountIn: 1n, slippageBps: 1,
  }), /minimum WSOL output/);
});

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
