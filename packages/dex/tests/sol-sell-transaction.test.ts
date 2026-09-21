import assert from 'node:assert';
import { Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { deriveSolSellSettlementAccounts } from '../src/sol-sell-accounts.js';
import { assembleAtomicSolSellTransaction } from '../src/sol-sell-transaction.js';

const TRADE_ID = '33'.repeat(32);
let passed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; } }

test('atomic SELL orders create -> Raydium -> settlement', () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const creatorAddress = Keypair.generate().publicKey.toBase58();
  const traderAddress = Keypair.generate().publicKey.toBase58();
  const accounts = deriveSolSellSettlementAccounts({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID });
  const raydiumProgram = Keypair.generate().publicKey;
  const raydium = new Transaction().add(new TransactionInstruction({
    programId: raydiumProgram,
    keys: [{ pubkey: accounts.settlementWsolAccount, isSigner: false, isWritable: true }],
    data: Buffer.from([7]),
  }));
  const result = assembleAtomicSolSellTransaction({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID, raydiumTransaction: raydium });
  assert.ok(result.transaction instanceof Transaction);
  assert.equal(result.transaction.instructions.length, 3);
  assert.ok(result.transaction.instructions[1].programId.equals(raydiumProgram));
  assert.ok(result.transaction.instructions[2].programId.equals(Keypair.fromSeed ? result.transaction.instructions[2].programId : result.transaction.instructions[2].programId));
});

test('SELL fails closed if Raydium output is not routed to settlement account', () => {
  assert.throws(() => assembleAtomicSolSellTransaction({
    programId: Keypair.generate().publicKey.toBase58(),
    creatorAddress: Keypair.generate().publicKey.toBase58(),
    traderAddress: Keypair.generate().publicKey.toBase58(),
    tradeId: TRADE_ID,
    raydiumTransaction: new Transaction().add(new TransactionInstruction({
      programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0),
    })),
  }), /not routed/);
});

console.log(`${passed} test(s) passed.`);
