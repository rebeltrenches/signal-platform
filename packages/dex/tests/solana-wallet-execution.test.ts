import assert from 'node:assert';
import { Keypair, PublicKey, Transaction, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { buildSimulateSignAndSendSolanaTrade, simulateSignAndSendSolanaTrade } from '../src/solana-wallet-execution.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; }
}

function makeTx(payer: PublicKey) {
  return new Transaction().add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
}

async function run() {
await test('failed simulation never asks wallet to sign or sends', async () => {
  const payer = Keypair.generate().publicKey;
  let signed = false;
  let sent = false;
  const connection: any = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
    simulateTransaction: async () => ({ value: { err: { InstructionError: [0, 'Custom'] }, logs: ['failed'], unitsConsumed: 5 } }),
    sendRawTransaction: async () => { sent = true; return 'unexpected'; },
  };
  const wallet: any = { publicKey: payer, signTransaction: async (tx: Transaction) => { signed = true; return tx; } };
  await assert.rejects(() => simulateSignAndSendSolanaTrade({ connection, wallet, transaction: makeTx(payer) }), /simulation failed/);
  assert.equal(signed, false);
  assert.equal(sent, false);
});

await test('successful simulation signs, sends and confirms in order', async () => {
  const signer = Keypair.generate();
  const events: string[] = [];
  const blockhash = Keypair.generate().publicKey.toBase58();
  const connection: any = {
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 99 }),
    simulateTransaction: async () => { events.push('simulate'); return { value: { err: null, logs: [], unitsConsumed: 10 } }; },
    sendRawTransaction: async () => { events.push('send'); return 'sig'; },
    confirmTransaction: async () => { events.push('confirm'); return { value: { err: null } }; },
  };
  const wallet: any = {
    publicKey: signer.publicKey,
    signTransaction: async (tx: Transaction) => { events.push('sign'); tx.partialSign(signer); return tx; },
  };
  const result = await simulateSignAndSendSolanaTrade({ connection, wallet, transaction: makeTx(signer.publicKey) });
  assert.equal(result.signature, 'sig');
  assert.deepEqual(events, ['simulate', 'sign', 'send', 'confirm']);
});

await test('confirmation error is surfaced instead of reporting success', async () => {
  const signer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const connection: any = {
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 99 }),
    simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 10 } }),
    sendRawTransaction: async () => 'sig',
    confirmTransaction: async () => ({ value: { err: { InstructionError: [0, 'Custom'] } } }),
  };
  const wallet: any = { publicKey: signer.publicKey, signTransaction: async (tx: Transaction) => { tx.partialSign(signer); return tx; } };
  await assert.rejects(() => simulateSignAndSendSolanaTrade({ connection, wallet, transaction: makeTx(signer.publicKey) }), /confirmation failed/);
});

await test('stale V0 transaction fails before simulation, signing or sending', async () => {
  const payer = Keypair.generate().publicKey;
  const fresh = Keypair.generate().publicKey.toBase58();
  const stale = Keypair.generate().publicKey.toBase58();
  let simulated = false, signed = false, sent = false;
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: stale, instructions: [] }).compileToV0Message();
  const connection: any = {
    getLatestBlockhash: async () => ({ blockhash: fresh, lastValidBlockHeight: 99 }),
    simulateTransaction: async () => { simulated = true; return { value: { err: null } }; },
    sendRawTransaction: async () => { sent = true; return 'sig'; },
  };
  const wallet: any = { publicKey: payer, signTransaction: async (tx: VersionedTransaction) => { signed = true; return tx; } };
  await assert.rejects(() => simulateSignAndSendSolanaTrade({ connection, wallet, transaction: new VersionedTransaction(message) }), /latest blockhash/);
  assert.equal(simulated, false); assert.equal(signed, false); assert.equal(sent, false);
});

await test('fresh-blockhash builder supports V0 and preserves simulate -> sign -> send -> confirm order', async () => {
  const signer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const events: string[] = [];
  let blockhashReads = 0;
  let replaceRecentBlockhash: boolean | undefined;
  const connection: any = {
    getLatestBlockhash: async () => { blockhashReads++; return { blockhash, lastValidBlockHeight: 99 }; },
    simulateTransaction: async (_tx: VersionedTransaction, opts: any) => { replaceRecentBlockhash = opts?.replaceRecentBlockhash; events.push('simulate'); return { value: { err: null, logs: [], unitsConsumed: 7 } }; },
    sendRawTransaction: async () => { events.push('send'); return 'v0sig'; },
    confirmTransaction: async () => { events.push('confirm'); return { value: { err: null } }; },
  };
  const wallet: any = {
    publicKey: signer.publicKey,
    signTransaction: async (tx: VersionedTransaction) => { events.push('sign'); tx.sign([signer]); return tx; },
  };
  const result = await buildSimulateSignAndSendSolanaTrade({
    connection, wallet,
    build: async (fresh) => new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: fresh, instructions: [] }).compileToV0Message()),
  });
  assert.equal(result.signature, 'v0sig');
  assert.equal(blockhashReads, 1);
  assert.equal(replaceRecentBlockhash, false);
  assert.deepEqual(events, ['simulate', 'sign', 'send', 'confirm']);
});

await test('disconnected wallet fails before network execution', async () => {
  let touched = false;
  const connection: any = { getLatestBlockhash: async () => { touched = true; throw new Error('should not run'); } };
  const wallet: any = { publicKey: null, signTransaction: async () => { throw new Error('should not sign'); } };
  await assert.rejects(() => simulateSignAndSendSolanaTrade({ connection, wallet, transaction: new Transaction() }), /not connected/);
  assert.equal(touched, false);
});

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
