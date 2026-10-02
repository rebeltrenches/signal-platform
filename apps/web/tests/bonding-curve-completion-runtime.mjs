import fs from 'node:fs';
import process from 'node:process';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from '@solana/spl-token';

const RPC = process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899';
const KEYPAIR_PATH = process.env.SIGNAL_RUNTIME_PAYER;
const PROGRAM_ID_TEXT = process.env.SIGNAL_RUNTIME_PROGRAM_ID;
if (!KEYPAIR_PATH || !PROGRAM_ID_TEXT) throw new Error('SIGNAL_RUNTIME_PAYER and SIGNAL_RUNTIME_PROGRAM_ID are required.');

const connection = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))));
const programId = new PublicKey(PROGRAM_ID_TEXT);
const platformWallet = new PublicKey('HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg');
const DECIMALS = 6;
const RAW_SUPPLY = 100_000_000n * 10n ** BigInt(DECIMALS);
const BPS = 10_000n;
const FEE_BPS = 100n;
const MAX_GROSS = 100_000_000_000n; // offer up to 100 SOL; program must take only what the final fill needs

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function ceilDiv(n, d) { return (n + d - 1n) / d; }
function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}
function initializeData(rawSupply, decimals) {
  const out = new Uint8Array(10);
  out[0] = 0;
  out.set(u64(rawSupply), 1);
  out[9] = decimals;
  return out;
}
function tradeData(op, amount, minimumOut) {
  const out = new Uint8Array(17);
  out[0] = op;
  out.set(u64(amount), 1);
  out.set(u64(minimumOut), 9);
  return out;
}
function curveAddress(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], programId)[0];
}
function decodeState(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  assert(bytes.length === 160 && bytes[0] === 2, 'valid v2 curve state');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    complete: bytes[2] !== 0,
    graduated: bytes[3] !== 0,
    virtualTokens: view.getBigUint64(68, true),
    virtualSol: view.getBigUint64(76, true),
    realTokens: view.getBigUint64(84, true),
    realSol: view.getBigUint64(92, true),
    totalSupply: view.getBigUint64(100, true),
    initialRealTokens: view.getBigUint64(108, true),
  };
}
async function curveState(curve) {
  const info = await connection.getAccountInfo(curve, 'confirmed');
  assert(info?.owner.equals(programId), 'curve state is owned by Signal program');
  return decodeState(info.data);
}
async function expectFailure(label, callback) {
  let failed = false;
  try { await callback(); } catch { failed = true; }
  assert(failed, `${label} must fail`);
  console.log(`✓ ${label} rejected`);
}

// Top up the disposable local-validator wallet. This never touches Devnet/Mainnet.
const balance = await connection.getBalance(payer.publicKey, 'confirmed');
if (balance < 120_000_000_000) {
  const sig = await connection.requestAirdrop(payer.publicKey, 120_000_000_000 - balance);
  await connection.confirmTransaction(sig, 'confirmed');
}

const mint = await createMint(connection, payer, payer.publicKey, null, DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID);
const curve = curveAddress(mint);
const vault = await getOrCreateAssociatedTokenAccount(connection, payer, mint, curve, true, 'confirmed', undefined, TOKEN_PROGRAM_ID);
await mintTo(connection, payer, mint, vault.address, payer, RAW_SUPPLY, [], undefined, TOKEN_PROGRAM_ID);
await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null, [], undefined, TOKEN_PROGRAM_ID);

const initializeIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: vault.address, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(initializeData(RAW_SUPPLY, DECIMALS)),
});
await sendAndConfirmTransaction(connection, new Transaction().add(initializeIx), [payer], { commitment: 'confirmed' });

const before = await curveState(curve);
assert(before.initialRealTokens === RAW_SUPPLY * 7_931n / 10_000n, '79.31% is offered by the curve');
const graduationTokens = RAW_SUPPLY - before.initialRealTokens;
assert(graduationTokens === RAW_SUPPLY * 2_069n / 10_000n, '20.69% is reserved for graduation');

// Reproduce the program's exact final-fill arithmetic. A huge max input is
// intentionally supplied; only exactGross may be transferred by the program.
const k = before.virtualTokens * before.virtualSol;
const targetVirtualTokens = before.virtualTokens - before.realTokens;
const requiredVirtualSol = ceilDiv(k, targetVirtualTokens);
const exactNet = requiredVirtualSol - before.virtualSol;
const exactFee = ceilDiv(exactNet * FEE_BPS, BPS - FEE_BPS);
const exactGross = exactNet + exactFee;
assert(exactGross < MAX_GROSS, '100 SOL max is larger than exact final-fill requirement');

const buyerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', undefined, TOKEN_PROGRAM_ID);
const platformBefore = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const buyKeys = [
  { pubkey: curve, isSigner: false, isWritable: true },
  { pubkey: mint, isSigner: false, isWritable: false },
  { pubkey: vault.address, isSigner: false, isWritable: true },
  { pubkey: buyerAta.address, isSigner: false, isWritable: true },
  { pubkey: payer.publicKey, isSigner: true, isWritable: true },
  { pubkey: platformWallet, isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
];
const finalBuyIx = new TransactionInstruction({
  programId,
  keys: buyKeys,
  data: Buffer.from(tradeData(1, MAX_GROSS, before.realTokens)),
});
await sendAndConfirmTransaction(connection, new Transaction().add(finalBuyIx), [payer], { commitment: 'confirmed' });

const after = await curveState(curve);
const buyer = await getAccount(connection, buyerAta.address, 'confirmed', TOKEN_PROGRAM_ID);
const finalVault = await getAccount(connection, vault.address, 'confirmed', TOKEN_PROGRAM_ID);
const platformAfter = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const mintState = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);

assert(after.complete, 'curve is marked complete at final fill');
assert(!after.graduated, 'local completion test does not pretend Raydium graduation occurred');
assert(after.realTokens === 0n, 'all sale inventory is sold');
assert(after.realSol === exactNet, 'curve receives only exact final-fill net SOL');
assert(platformAfter - platformBefore === exactFee, 'platform receives exact 1% final-fill fee');
assert(BigInt(buyer.amount.toString()) === before.initialRealTokens, 'buyer receives exactly the 79.31% curve inventory');
assert(BigInt(finalVault.amount.toString()) === graduationTokens, '20.69% graduation inventory remains in program-owned vault');
assert(mintState.mintAuthority === null && mintState.freezeAuthority === null, 'authorities stay locked after completion');
console.log(`✓ final fill exact charge verified: max ${MAX_GROSS} lamports, actual gross ${exactGross} lamports`);
console.log('✓ completed curve holds only the 20.69% Raydium graduation reserve');

await expectFailure('buy after completion', async () => {
  const ix = new TransactionInstruction({ programId, keys: buyKeys, data: Buffer.from(tradeData(1, 10_000_000n, 1n)) });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: 'confirmed' });
});
await expectFailure('sell after completion', async () => {
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vault.address, isSigner: false, isWritable: true },
      { pubkey: buyerAta.address, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: platformWallet, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(tradeData(2, 1_000_000n, 1n)),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: 'confirmed' });
});

console.log('✓ Signal bonding-curve full-completion runtime test passed');
