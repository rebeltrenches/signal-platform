// launch-integrity.js against the real @solana/web3.js and spl-token:
// builds the exact launch transactions, lets a simulated "Phantom" add its
// Mainnet safety/compute-budget instructions (or tamper), signs with real
// keypairs, and checks what is accepted and what is rejected.
//
// Run with: node apps/web/tests/launch-integrity.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");

// apps/web is "type": "commonjs"; load the browser module from an ESM folder.
const esm = await mkdtemp(join(tmpdir(), "launch-integrity-"));
await cp("apps/web/src/client/launch-integrity.js", join(esm, "launch-integrity.js"));
await writeFile(join(esm, "package.json"), '{ "type": "module" }');
const { launchTransactionDifference, finalizeSignedTransaction, LIGHTHOUSE_PROGRAM_ID } = await import(
  pathToFileURL(join(esm, "launch-integrity.js")).href
);

const LIGHTHOUSE = new web3.PublicKey(LIGHTHOUSE_PROGRAM_ID);
const TREASURY = new web3.PublicKey("HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg");
const wallet = web3.Keypair.generate();
const payer = wallet.publicKey;
const attackerKeypair = web3.Keypair.generate();
const attacker = attackerKeypair.publicKey;
const blockhash = web3.Keypair.generate().publicKey.toBase58();

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const budget = (units = 40_000, price = 50_000) => [
  web3.ComputeBudgetProgram.setComputeUnitLimit({ units }),
  web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
];
function transaction(instructions, feePayer = payer, recentBlockhash = blockhash) {
  const tx = new web3.Transaction().add(...instructions);
  tx.feePayer = feePayer;
  tx.recentBlockhash = recentBlockhash;
  tx.lastValidBlockHeight = 1000;
  return tx;
}
// Step 2 exactly as launch-solana.js builds it.
function supplyInstructions(mint, { amount = 100_000_000n * 10n ** 6n, destinationOwner = payer, newAuthority = null } = {}) {
  const ata = spl.getAssociatedTokenAddressSync(mint, destinationOwner, false, spl.TOKEN_PROGRAM_ID);
  return [
    spl.createAssociatedTokenAccountInstruction(payer, ata, destinationOwner, mint, spl.TOKEN_PROGRAM_ID),
    spl.createMintToInstruction(mint, ata, payer, amount, [], spl.TOKEN_PROGRAM_ID),
    spl.createSetAuthorityInstruction(mint, payer, spl.AuthorityType.MintTokens, newAuthority, [], spl.TOKEN_PROGRAM_ID),
  ];
}
// Step 1 exactly as launch-solana.js builds it.
function createInstructions(mint, { feeTo = TREASURY, fee = 1_000_000 } = {}) {
  return [
    web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: feeTo, lamports: fee }),
    web3.SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, space: spl.MINT_SIZE, lamports: 1_066_800, programId: spl.TOKEN_PROGRAM_ID }),
    spl.createInitializeMintInstruction(mint, 6, payer, null, spl.TOKEN_PROGRAM_ID),
  ];
}
// A Lighthouse assertion: read-only accounts from the transaction.
const lighthouse = (...accounts) => new web3.TransactionInstruction({
  programId: LIGHTHOUSE,
  keys: accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
  data: Buffer.from([4, 1, 0, 0, 0, 0, 0, 0, 0]),
});

/** What a wallet returns: its own (possibly changed) message, signed by the
 *  wallet, deserialized from bytes. Existing co-signatures carry over only if
 *  the message is unchanged, as with a real wallet. */
function walletSigns(original, instructions = null, { feePayer, recentBlockhash, signers = [wallet] } = {}) {
  let tx;
  if (instructions) {
    tx = transaction(instructions, feePayer ?? original.feePayer, recentBlockhash ?? original.recentBlockhash);
  } else {
    tx = web3.Transaction.from(original.serialize({ requireAllSignatures: false, verifySignatures: false }));
  }
  tx.partialSign(...signers);
  return web3.Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

const mintKeypair = web3.Keypair.generate();
const mint = mintKeypair.publicKey;
const supplyTx = transaction([...budget(), ...supplyInstructions(mint)]);
const createTx = transaction([...budget(), ...createInstructions(mint)]);
createTx.partialSign(mintKeypair);
const ata = spl.getAssociatedTokenAddressSync(mint, payer, false, spl.TOKEN_PROGRAM_ID);

console.log("launch-integrity.test.mjs\n");

// --- Accepted ---
test("an unchanged transaction is accepted and sent as signed", () => {
  const signed = walletSigns(supplyTx);
  assert.equal(launchTransactionDifference(web3, supplyTx.compileMessage(), signed.compileMessage()), null);
  assert.equal(finalizeSignedTransaction(supplyTx.serializeMessage(), signed), false);
});
test("Phantom Mainnet changes are accepted: new compute budget + two Lighthouse assertions (step 2)", () => {
  const signed = walletSigns(supplyTx, [...budget(120_000, 250_000), ...supplyInstructions(mint), lighthouse(payer), lighthouse(ata, mint)]);
  assert.equal(launchTransactionDifference(web3, supplyTx.compileMessage(), signed.compileMessage()), null);
  assert.equal(finalizeSignedTransaction(supplyTx.serializeMessage(), signed), true);
  assert.ok(signed.verifySignatures());
});
test("the same on step 1: the new mint re-signs the changed message", () => {
  const signed = walletSigns(createTx, [...budget(60_000, 200_000), ...createInstructions(mint), lighthouse(payer)]);
  assert.equal(launchTransactionDifference(web3, createTx.compileMessage(), signed.compileMessage()), null);
  assert.equal(finalizeSignedTransaction(createTx.serializeMessage(), signed, [mintKeypair]), true);
  assert.ok(signed.verifySignatures(), "wallet and mint signatures are both valid");
});
test("without our co-signer, a changed step 1 is refused before sending", () => {
  const signed = walletSigns(createTx, [...budget(), ...createInstructions(mint), lighthouse(payer)]);
  assert.throws(() => finalizeSignedTransaction(createTx.serializeMessage(), signed, []), /signature is missing/);
});
test("Phantom's compute budget alone (no Lighthouse) is accepted", () => {
  assert.equal(launchTransactionDifference(web3, supplyTx.compileMessage(), walletSigns(supplyTx, [...budget(200_000, 1), ...supplyInstructions(mint)]).compileMessage()), null);
});

// --- Rejected: our instructions, amounts, accounts, recipient, authority ---
const rejected = (name, instructions, options) => {
  const original = options?.original ?? supplyTx;
  const reason = launchTransactionDifference(web3, original.compileMessage(), walletSigns(original, instructions, options).compileMessage());
  test(`rejected: ${name} (${reason})`, () => assert.notEqual(reason, null));
};
rejected("mint amount changed", [...budget(), ...supplyInstructions(mint, { amount: 1n })]);
rejected("supply sent to another owner", [...budget(), ...supplyInstructions(mint, { destinationOwner: attacker })]);
rejected("mint authority handed to someone else instead of revoked", [...budget(), ...supplyInstructions(mint, { newAuthority: attacker })]);
rejected("revoke removed", [...budget(), ...supplyInstructions(mint).slice(0, 2)]);
rejected("our instructions reordered", [...budget(), ...[...supplyInstructions(mint)].reverse()]);
rejected("an extra transfer appended", [...budget(), ...supplyInstructions(mint), web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: attacker, lamports: 1 })]);
rejected("fee sent to another recipient (step 1)", [...budget(), ...createInstructions(mint, { feeTo: attacker })], { original: createTx, signers: [wallet, mintKeypair] });
rejected("fee amount changed (step 1)", [...budget(), ...createInstructions(mint, { fee: 1 })], { original: createTx, signers: [wallet, mintKeypair] });
rejected("different blockhash", [...budget(), ...supplyInstructions(mint)], { recentBlockhash: web3.Keypair.generate().publicKey.toBase58() });
rejected("different fee payer", [...budget(), ...supplyInstructions(mint)], { feePayer: attacker, signers: [attackerKeypair] });
rejected("safety instruction touching an account outside the transaction", [...budget(), ...supplyInstructions(mint), lighthouse(attacker)]);
rejected("safety instruction writing an account ours only read", [
  ...budget(), ...supplyInstructions(mint),
  new web3.TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: true }], data: Buffer.from([1]) }),
]);
rejected("safety instruction requiring another signer", [
  ...budget(), ...supplyInstructions(mint),
  new web3.TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: attacker, isSigner: true, isWritable: false }], data: Buffer.from([1]) }),
], { signers: [wallet] });
rejected("compute unit limit above Solana's maximum", [...budget(1_500_000), ...supplyInstructions(mint)]);
rejected("two compute unit prices", [...budget(), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 9 }), ...supplyInstructions(mint)]);
rejected("other compute budget instructions (heap frame)", [...budget(), web3.ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 }), ...supplyInstructions(mint)]);

test("rejected: a wallet that edits our transaction object in place (checked against the pre-signing snapshot)", () => {
  const tx = transaction([...budget(), ...supplyInstructions(mint)]);
  const expected = tx.compileMessage();
  const expectedBytes = tx.serializeMessage();
  tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: attacker, lamports: 1 }));
  tx.partialSign(wallet);
  assert.match(launchTransactionDifference(web3, expected, tx.compileMessage()) ?? "", /added instruction/);
  assert.equal(finalizeSignedTransaction(expectedBytes, tx), true, "and its bytes differ from the snapshot");
});

await rm(esm, { recursive: true, force: true });
console.log(`\n${passed} test(s) passed.`);
