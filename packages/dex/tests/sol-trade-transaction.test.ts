import assert from 'node:assert';
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assembleSolBuyTransaction } from '../src/sol-trade-transaction.js';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAILED: ${name}`); throw err; }
}

test('BUY assembly prepends exact 1% creator SOL transfer', () => {
  const buyer = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const raydiumProgram = Keypair.generate().publicKey;
  const raydium = new Transaction().add(new TransactionInstruction({
    programId: raydiumProgram,
    keys: [],
    data: Buffer.from([1]),
  }));

  const result = assembleSolBuyTransaction({
    buyerAddress: buyer.toBase58(),
    creatorAddress: creator.toBase58(),
    grossSolLamports: 1_000_000_000n,
    raydiumTransaction: raydium,
  });

  assert.equal(result.creatorFeeLamports, 10_000_000n);
  assert.equal(result.raydiumInputLamports, 990_000_000n);
  assert.ok(result.transaction instanceof Transaction);
  assert.equal(result.transaction.instructions.length, 2);
  assert.ok(result.transaction.instructions[0].programId.equals(SystemProgram.programId));
  assert.ok(result.transaction.instructions[0].keys[0].pubkey.equals(buyer));
  assert.ok(result.transaction.instructions[0].keys[1].pubkey.equals(creator));
  assert.ok(result.transaction.instructions[1].programId.equals(raydiumProgram));
});

test('BUY assembly rejects zero or negative gross SOL amounts', () => {
  const buyer = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  for (const amount of [0n, -1n]) {
    assert.throws(() => assembleSolBuyTransaction({ buyerAddress: buyer, creatorAddress: creator, grossSolLamports: amount, raydiumTransaction: new Transaction() }), /greater than zero/);
  }
});

test('BUY assembly rejects creator self-trade until explicitly handled', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  assert.throws(() => assembleSolBuyTransaction({
    buyerAddress: wallet,
    creatorAddress: wallet,
    grossSolLamports: 1_000_000_000n,
    raydiumTransaction: new Transaction(),
  }));
});

console.log(`${passed} test(s) passed.`);
