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
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  transfer,
} from '@solana/spl-token';

const RPC = process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899';
const KEYPAIR_PATH = process.env.SIGNAL_RUNTIME_PAYER;
const PROGRAM_ID_TEXT = process.env.SIGNAL_RUNTIME_PROGRAM_ID;
if (!KEYPAIR_PATH || !PROGRAM_ID_TEXT) throw new Error('SIGNAL_RUNTIME_PAYER and SIGNAL_RUNTIME_PROGRAM_ID are required.');

const connection = new Connection(RPC, 'confirmed');
const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))));
const trader = Keypair.generate();
const programId = new PublicKey(PROGRAM_ID_TEXT);
const platformWallet = new PublicKey('HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg');
const DECIMALS = 6;
const RAW_SUPPLY = 100_000_000n * 10n ** BigInt(DECIMALS);

function assert(condition, message) { if (!condition) throw new Error(`Assertion failed: ${message}`); }
function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}
function initData() {
  const out = new Uint8Array(10);
  out[0] = 0;
  out.set(u64(RAW_SUPPLY), 1);
  out[9] = DECIMALS;
  return out;
}
function tradeData(op, amount, minimumOut) {
  const out = new Uint8Array(17);
  out[0] = op;
  out.set(u64(amount), 1);
  out.set(u64(minimumOut), 9);
  return out;
}
async function expectFailure(label, fn) {
  let failed = false;
  try { await fn(); } catch { failed = true; }
  assert(failed, `${label} must fail`);
  console.log(`✓ ${label} rejected`);
}

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: trader.publicKey, lamports: 2_000_000_000 })),
  [creator],
  { commitment: 'confirmed' },
);
assert((await connection.getBalance(trader.publicKey, 'confirmed')) > 1_900_000_000, 'independent trader is funded');

const mint = await createMint(connection, creator, creator.publicKey, null, DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID);
const curve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], programId)[0];
const curveVault = await getOrCreateAssociatedTokenAccount(connection, creator, mint, curve, true, 'confirmed', undefined, TOKEN_PROGRAM_ID);
await mintTo(connection, creator, mint, curveVault.address, creator, RAW_SUPPLY, [], undefined, TOKEN_PROGRAM_ID);
await setAuthority(connection, creator, mint, creator, AuthorityType.MintTokens, null, [], undefined, TOKEN_PROGRAM_ID);

const initIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault.address, isSigner: false, isWritable: true },
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(initData()),
});
await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [creator], { commitment: 'confirmed' });

const creatorToken = await getOrCreateAssociatedTokenAccount(connection, creator, mint, creator.publicKey, false, 'confirmed', undefined, TOKEN_PROGRAM_ID);
const traderToken = await getOrCreateAssociatedTokenAccount(connection, trader, mint, trader.publicKey, false, 'confirmed', undefined, TOKEN_PROGRAM_ID);
assert(BigInt((await getAccount(connection, creatorToken.address, 'confirmed', TOKEN_PROGRAM_ID)).amount.toString()) === 0n, 'creator starts with zero tokens');

// A token transfer signed by the human creator cannot drain the program-owned
// curve vault because only the curve PDA is its SPL Token authority.
await expectFailure('creator direct drain of curve token vault', async () => {
  await transfer(
    connection,
    creator,
    curveVault.address,
    creatorToken.address,
    creator,
    1n,
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );
});
assert(BigInt((await getAccount(connection, creatorToken.address, 'confirmed', TOKEN_PROGRAM_ID)).amount.toString()) === 0n, 'failed drain leaves creator token balance at zero');

// The same curve cannot be initialized twice or have its creator/state reset.
await expectFailure('duplicate curve initialization', async () => {
  await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [creator], { commitment: 'confirmed' });
});

// A trader cannot redirect purchased tokens into an ATA owned by somebody
// else while still presenting themselves as the buyer.
const mismatchBuy = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault.address, isSigner: false, isWritable: true },
    { pubkey: creatorToken.address, isSigner: false, isWritable: true },
    { pubkey: trader.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(tradeData(1, 100_000_000n, 1n)),
});
await expectFailure('buy output redirected to another wallet', async () => {
  await sendAndConfirmTransaction(connection, new Transaction().add(mismatchBuy), [trader], { commitment: 'confirmed' });
});

const platformBefore = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const traderBefore = BigInt(await connection.getBalance(trader.publicKey, 'confirmed'));
const buyIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault.address, isSigner: false, isWritable: true },
    { pubkey: traderToken.address, isSigner: false, isWritable: true },
    { pubkey: trader.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(tradeData(1, 100_000_000n, 1n)),
});
await sendAndConfirmTransaction(connection, new Transaction().add(buyIx), [trader], { commitment: 'confirmed' });
const traderAfterBuy = await getAccount(connection, traderToken.address, 'confirmed', TOKEN_PROGRAM_ID);
const bought = BigInt(traderAfterBuy.amount.toString());
assert(bought > 0n, 'independent wallet receives curve tokens');
assert(BigInt((await getAccount(connection, creatorToken.address, 'confirmed', TOKEN_PROGRAM_ID)).amount.toString()) === 0n, 'creator remains at zero after another wallet buys');
assert(BigInt(await connection.getBalance(platformWallet, 'confirmed')) - platformBefore === 1_000_000n, 'independent-wallet buy pays exact 1% Signal fee');
assert(BigInt(await connection.getBalance(trader.publicKey, 'confirmed')) < traderBefore - 99_000_000n, 'trader funded its own purchase and network fee');

const sellAmount = bought / 2n;
const sellIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault.address, isSigner: false, isWritable: true },
    { pubkey: traderToken.address, isSigner: false, isWritable: true },
    { pubkey: trader.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(tradeData(2, sellAmount, 1n)),
});
const traderSolBeforeSell = BigInt(await connection.getBalance(trader.publicKey, 'confirmed'));
await sendAndConfirmTransaction(connection, new Transaction().add(sellIx), [trader], { commitment: 'confirmed' });
const traderAfterSell = await getAccount(connection, traderToken.address, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(traderAfterSell.amount.toString()) === bought - sellAmount, 'independent trader can sell only its own tokens back');
assert(BigInt(await connection.getBalance(trader.publicKey, 'confirmed')) > traderSolBeforeSell, 'independent trader receives SOL from sell');
assert(BigInt((await getAccount(connection, creatorToken.address, 'confirmed', TOKEN_PROGRAM_ID)).amount.toString()) === 0n, 'creator still has zero automatic tokens after independent buy/sell');

console.log('✓ independent wallet buy and sell work without creator privileges');
console.log('✓ program-owned token vault cannot be drained by the human creator');
console.log('✓ duplicate initialization and cross-wallet output redirection are blocked');
console.log('✓ Signal bonding-curve multi-wallet/custody runtime test passed');
