import assert from 'node:assert';
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { simulateSignAndSendSolanaTrade } from '../src/solana-wallet-execution.js';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; }
}

function makeTx(payer: PublicKey) {
  return new Transaction().add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
}

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

await test('disconnected wallet fails before network execution', async () => {
  let touched = false;
  const connection: any = { getLatestBlockhash: async () => { touched = true; throw new Error('should not run'); } };
  const wallet: any = { publicKey: null, signTransaction: async () => { throw new Error('should not sign'); } };
  await assert.rejects(() => simulateSignAndSendSolanaTrade({ connection, wallet, transaction: new Transaction() }), /not connected/);
  assert.equal(touched, false);
});

console.log(`${passed} test(s) passed.`);
