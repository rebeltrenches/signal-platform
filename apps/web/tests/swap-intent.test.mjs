// The post-signing tamper check (apps/web/src/client/swap-intent.js), run
// on real v0 transactions: what Signal builds (swap + 1% fee transfer, with
// an address lookup table) versus what a wallet could return signed.
//
// Run with: node apps/web/tests/swap-intent.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as web3 from "@solana/web3.js";

// apps/web is CommonJS; the browser module is loaded as ES module source.
const source = await readFile(new URL("../src/client/swap-intent.js", import.meta.url), "utf8");
const { createIntentCheck, LIGHTHOUSE_PROGRAM_ID } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const check = createIntentCheck(web3);
let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const key = () => web3.Keypair.generate().publicKey;
const payer = key();
const feeWallet = key();
const otherWallet = key();
const swapProgram = key();
const lighthouse = new web3.PublicKey(LIGHTHOUSE_PROGRAM_ID);
const tokenAccount = key();
const pool = key();
const tableAccounts = [key(), key(), pool];
const table = new web3.AddressLookupTableAccount({
  key: key(),
  state: { deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: tableAccounts },
});
const blockhash = web3.Keypair.generate().publicKey.toBase58();

const swap = new web3.TransactionInstruction({
  programId: swapProgram,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: tokenAccount, isSigner: false, isWritable: true },
    ...tableAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
  ],
  data: Uint8Array.from([7, 1, 2, 3]),
});
const fee = (to = feeWallet, lamports = 100_000) => web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports });
const computeBudget = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })];
const message = (instructions) => new web3.TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message([table]);

/** A Lighthouse assertion like Phantom's guard: reads the payer and the
 *  token account, and may use its own (new, writable) memory account. */
const lighthouseAssertion = (extraKeys = []) => new web3.TransactionInstruction({
  programId: lighthouse,
  keys: [{ pubkey: tokenAccount, isSigner: false, isWritable: false }, ...extraKeys],
  data: Uint8Array.from([4, 0, 1, 2, 3, 4, 5, 6, 7]),
});
const memoryWrite = () => new web3.TransactionInstruction({
  programId: lighthouse,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: key(), isSigner: false, isWritable: true }, // Lighthouse memory account, not in Signal's instructions
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Uint8Array.from([0, 1, 2]),
});

const signal = message([...computeBudget, swap, fee()]);
const signed = (instructions) => message(instructions);

console.log("swap-intent.test.mjs\n");

test("unchanged transaction: allowed", () => {
  assert.equal(check(signal, signed([...computeBudget, swap, fee()]), [table]), null);
});

test("Lighthouse assertions appended by the wallet (one, or four with a new memory account): allowed", () => {
  assert.equal(check(signal, signed([...computeBudget, swap, fee(), lighthouseAssertion()]), [table]), null);
  assert.equal(check(signal, signed([...computeBudget, swap, fee(), memoryWrite(), lighthouseAssertion(), lighthouseAssertion(), lighthouseAssertion()]), [table]), null);
});

test("the wallet changing only compute-budget (priority fee) instructions: allowed, as before", () => {
  const priority = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];
  assert.equal(check(signal, signed([...priority, swap, fee(), lighthouseAssertion()]), [table]), null);
});

test("any other program appended: blocked, naming it", () => {
  const other = new web3.TransactionInstruction({ programId: key(), keys: [], data: Uint8Array.from([1]) });
  const result = check(signal, signed([...computeBudget, swap, fee(), other]), [table]);
  assert.match(result, /^added instruction: #3 /);
  assert.ok(result.includes(other.programId.toBase58()));
  const drain = fee(otherWallet, 5_000_000);
  assert.match(check(signal, signed([...computeBudget, swap, fee(), drain]), [table]), /^added instruction: #3 11111111111111111111111111111111/);
});

test("Lighthouse plus another program appended: blocked", () => {
  const other = new web3.TransactionInstruction({ programId: key(), keys: [], data: Uint8Array.from([1]) });
  assert.match(check(signal, signed([...computeBudget, swap, fee(), lighthouseAssertion(), other]), [table]), /^added instruction/);
});

test("modified fee instruction (other recipient, or other amount): blocked", () => {
  assert.equal(check(signal, signed([...computeBudget, swap, fee(otherWallet)]), [table]), "account at instruction 2");
  assert.equal(check(signal, signed([...computeBudget, swap, fee(feeWallet, 1)]), [table]), "data at instruction 2");
});

test("Lighthouse appended plus a modified fee instruction: blocked", () => {
  assert.notEqual(check(signal, signed([...computeBudget, swap, fee(otherWallet), lighthouseAssertion()]), [table]), null);
  assert.notEqual(check(signal, signed([...computeBudget, swap, fee(feeWallet, 1), lighthouseAssertion()]), [table]), null);
});

test("Lighthouse plus a changed or missing swap instruction: blocked", () => {
  const changedSwap = new web3.TransactionInstruction({ programId: swapProgram, keys: swap.keys, data: Uint8Array.from([7, 1, 2, 4]) });
  assert.notEqual(check(signal, signed([...computeBudget, changedSwap, fee(), lighthouseAssertion()]), [table]), null);
  assert.notEqual(check(signal, signed([...computeBudget, fee(), lighthouseAssertion(), lighthouseAssertion()]), [table]), null);
});

test("Lighthouse placed before Signal's instructions (not appended): blocked", () => {
  assert.notEqual(check(signal, signed([...computeBudget, lighthouseAssertion(), swap, fee()]), [table]), null);
});

test("a Lighthouse instruction requiring another signer: blocked", () => {
  const extraSigner = lighthouseAssertion([{ pubkey: key(), isSigner: true, isWritable: false }]);
  assert.notEqual(check(signal, signed([...computeBudget, swap, fee(), extraSigner]), [table]), null);
});

test("different blockhash or fee payer: blocked, as before", () => {
  const otherBlockhash = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: key().toBase58(), instructions: [...computeBudget, swap, fee()] }).compileToV0Message([table]);
  assert.equal(check(signal, otherBlockhash, [table]), "blockhash");
  const otherPayer = new web3.TransactionMessage({ payerKey: otherWallet, recentBlockhash: blockhash, instructions: [...computeBudget, swap, fee()] }).compileToV0Message([table]);
  assert.equal(check(signal, otherPayer, [table]), "payer");
});

console.log(`\n${passed} passed.`);
