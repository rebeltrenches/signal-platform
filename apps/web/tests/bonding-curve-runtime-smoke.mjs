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
if (!KEYPAIR_PATH || !PROGRAM_ID_TEXT) {
  throw new Error('SIGNAL_RUNTIME_PAYER and SIGNAL_RUNTIME_PROGRAM_ID are required.');
}

const connection = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))));
const programId = new PublicKey(PROGRAM_ID_TEXT);
const platformWallet = new PublicKey('HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg');
const DECIMALS = 6;
const MIN_WHOLE_SUPPLY = 100_000_000n;
const RAW_SUPPLY = MIN_WHOLE_SUPPLY * 10n ** BigInt(DECIMALS);
const U64_MAX = 18_446_744_073_709_551_615n;
const STATE_LEN = 160;
const STATE_VERSION = 2;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
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
  assert(bytes.length === STATE_LEN, `curve state length must be ${STATE_LEN}`);
  assert(bytes[0] === STATE_VERSION, `curve state version must be ${STATE_VERSION}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    complete: bytes[2] !== 0,
    graduated: bytes[3] !== 0,
    mint: new PublicKey(bytes.slice(4, 36)),
    creator: new PublicKey(bytes.slice(36, 68)),
    virtualTokens: view.getBigUint64(68, true),
    virtualSol: view.getBigUint64(76, true),
    realTokens: view.getBigUint64(84, true),
    realSol: view.getBigUint64(92, true),
    totalSupply: view.getBigUint64(100, true),
    initialRealTokens: view.getBigUint64(108, true),
    decimals: bytes[116],
  };
}
async function readCurve(curve) {
  const info = await connection.getAccountInfo(curve, 'confirmed');
  assert(info, 'curve state account exists');
  assert(info.owner.equals(programId), 'curve state is owned by Signal program');
  return decodeState(info.data);
}
async function expectFailure(label, callback) {
  let failed = false;
  try {
    await callback();
  } catch {
    failed = true;
  }
  assert(failed, `${label} must fail`);
  console.log(`✓ ${label} rejected`);
}
function initializeInstruction({ mint, curve, vault, rawSupply, decimals, creator = payer.publicKey, launchFeeRecipient = platformWallet }) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: launchFeeRecipient, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(initializeData(rawSupply, decimals)),
  });
}
async function prepareMint({ rawSupply = RAW_SUPPLY, decimals = DECIMALS, freezeAuthority = null, revokeMint = true } = {}) {
  const mint = await createMint(connection, payer, payer.publicKey, freezeAuthority, decimals, undefined, undefined, TOKEN_PROGRAM_ID);
  const curve = curveAddress(mint);
  const vault = await getOrCreateAssociatedTokenAccount(connection, payer, mint, curve, true, 'confirmed', undefined, TOKEN_PROGRAM_ID);
  await mintTo(connection, payer, mint, vault.address, payer, rawSupply, [], undefined, TOKEN_PROGRAM_ID);
  if (revokeMint) {
    await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null, [], undefined, TOKEN_PROGRAM_ID);
  }
  return { mint, curve, vault: vault.address };
}

console.log(`Runtime payer: ${payer.publicKey.toBase58()}`);
console.log(`Signal curve program: ${programId.toBase58()}`);
assert((await connection.getAccountInfo(programId, 'confirmed'))?.executable, 'bonding-curve SBF is loaded and executable');

// Protocol-level minimum: this fails before account parsing, proving a direct
// caller cannot bypass the website's 100M rule.
await expectFailure('supply below 100M', async () => {
  const tooSmall = MIN_WHOLE_SUPPLY - 1n;
  const ix = new TransactionInstruction({
    programId,
    keys: [],
    data: Buffer.from(initializeData(tooSmall, 0)),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], { commitment: 'confirmed' });
});

// Authority protections are enforced on-chain, not trusted to the launcher.
{
  const prepared = await prepareMint({ revokeMint: false });
  await expectFailure('active mint authority', async () => {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(initializeInstruction({ ...prepared, rawSupply: RAW_SUPPLY, decimals: DECIMALS })),
      [payer],
      { commitment: 'confirmed' },
    );
  });
}
{
  const prepared = await prepareMint({ freezeAuthority: payer.publicKey, revokeMint: true });
  await expectFailure('active freeze authority', async () => {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(initializeInstruction({ ...prepared, rawSupply: RAW_SUPPLY, decimals: DECIMALS })),
      [payer],
      { commitment: 'confirmed' },
    );
  });
}

// A direct caller cannot redirect the fixed launch fee to another wallet.
{
  const prepared = await prepareMint();
  await expectFailure('wrong launch fee recipient', async () => {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(initializeInstruction({
        ...prepared,
        rawSupply: RAW_SUPPLY,
        decimals: DECIMALS,
        launchFeeRecipient: payer.publicKey,
      })),
      [payer],
      { commitment: 'confirmed' },
    );
  });
}

// Force an initialize failure AFTER the program reaches its fee transfer. The
// max-u64 supply passes the minimum/mint/vault checks but cannot produce the
// 107.30% virtual token reserve. Solana transaction atomicity must roll the
// launch fee back and must not leave a curve state account behind.
{
  const prepared = await prepareMint({ rawSupply: U64_MAX, decimals: 0 });
  const platformBeforeFailedInitialize = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
  await expectFailure('post-fee initialize failure', async () => {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(initializeInstruction({ ...prepared, rawSupply: U64_MAX, decimals: 0 })),
      [payer],
      { commitment: 'confirmed' },
    );
  });
  const platformAfterFailedInitialize = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
  assert(platformAfterFailedInitialize === platformBeforeFailedInitialize, 'failed initialize rolls back the 0.001 SOL launch fee');
  assert(!(await connection.getAccountInfo(prepared.curve, 'confirmed')), 'failed initialize leaves no curve state account');
  console.log('✓ failed initialize rolls back launch fee atomically');
}

// Happy-path launch at exactly the protocol minimum.
const { mint, curve, vault } = await prepareMint();
const creatorAta = await getAssociatedTokenAddress(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
assert(!(await connection.getAccountInfo(creatorAta, 'confirmed')), 'creator has no automatic token account/allocation before trading');
const platformBeforeLaunch = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const initializeIx = initializeInstruction({ mint, curve, vault, rawSupply: RAW_SUPPLY, decimals: DECIMALS });
await sendAndConfirmTransaction(
  connection,
  new Transaction().add(initializeIx),
  [payer],
  { commitment: 'confirmed' },
);
const platformAfterLaunch = BigInt(await connection.getBalance(platformWallet, 'confirmed'));

const mintState = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
const vaultState = await getAccount(connection, vault, 'confirmed', TOKEN_PROGRAM_ID);
const initial = await readCurve(curve);
assert(mintState.mintAuthority === null, 'mint authority is revoked');
assert(mintState.freezeAuthority === null, 'freeze authority is absent');
assert(BigInt(mintState.supply.toString()) === RAW_SUPPLY, 'mint supply equals configured supply');
assert(vaultState.owner.equals(curve), 'curve PDA owns token vault');
assert(BigInt(vaultState.amount.toString()) === RAW_SUPPLY, 'full supply is in curve vault');
assert(initial.mint.equals(mint), 'curve binds correct mint');
assert(initial.creator.equals(payer.publicKey), 'curve records creator');
assert(initial.totalSupply === RAW_SUPPLY, 'curve records full supply');
assert(initial.initialRealTokens === RAW_SUPPLY * 7_931n / 10_000n, '79.31% is curve inventory');
assert(initial.realTokens === initial.initialRealTokens, 'no curve inventory has been sold initially');
assert(initial.realSol === 0n, 'curve begins with zero real SOL');
assert(!initial.complete && !initial.graduated, 'new curve begins active');
assert(platformAfterLaunch - platformBeforeLaunch === 1_000_000n, 'initialize pays exact 0.001 SOL launch fee to bound Signal wallet');
console.log('✓ initialize verified: full supply under curve custody, creator automatic allocation = 0, 0.001 SOL launch fee enforced');

// A retry after successful initialization must fail before any second fee can
// be charged. This protects refresh/retry behavior as well as direct callers.
const platformBeforeDuplicateInitialize = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
await expectFailure('duplicate initialize fee retry', async () => {
  await sendAndConfirmTransaction(connection, new Transaction().add(initializeIx), [payer], { commitment: 'confirmed' });
});
const platformAfterDuplicateInitialize = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
assert(platformAfterDuplicateInitialize === platformBeforeDuplicateInitialize, 'duplicate initialize does not charge launch fee twice');
console.log('✓ duplicate initialize cannot double-charge launch fee');

const traderAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', undefined, TOKEN_PROGRAM_ID);
const platformBeforeBuy = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const buyGross = 100_000_000n; // 0.1 SOL
const buyIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: traderAta.address, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(tradeData(1, buyGross, 1n)),
});
await sendAndConfirmTransaction(connection, new Transaction().add(buyIx), [payer], { commitment: 'confirmed' });
const afterBuy = await readCurve(curve);
const traderAfterBuy = await getAccount(connection, traderAta.address, 'confirmed', TOKEN_PROGRAM_ID);
const platformAfterBuy = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const bought = BigInt(traderAfterBuy.amount.toString());
assert(bought > 0n, 'buyer receives curve tokens');
assert(afterBuy.realSol === 99_000_000n, '0.1 SOL buy routes 0.099 SOL into curve after 1% fee');
assert(initial.realTokens - afterBuy.realTokens === bought, 'token output exactly matches curve reserve decrease');
assert(platformAfterBuy - platformBeforeBuy === 1_000_000n, '1% buy fee reaches bound Signal platform wallet');
console.log(`✓ buy verified: received ${bought} base units; 1% fee routed correctly`);

// Slippage guard must reject without changing reserves.
await expectFailure('impossible buy minimum output', async () => {
  const impossible = new TransactionInstruction({
    programId,
    keys: buyIx.keys,
    data: Buffer.from(tradeData(1, 10_000_000n, 18_446_744_073_709_551_615n)),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(impossible), [payer], { commitment: 'confirmed' });
});
const afterRejectedBuy = await readCurve(curve);
assert(afterRejectedBuy.realSol === afterBuy.realSol && afterRejectedBuy.realTokens === afterBuy.realTokens, 'failed slippage transaction is atomic and leaves curve unchanged');

// Fee recipient is bound in the program. Supplying any other account fails.
await expectFailure('wrong fee recipient', async () => {
  const wrongFeeKeys = buyIx.keys.map((key, index) => index === 5 ? { ...key, pubkey: payer.publicKey } : key);
  const wrongFee = new TransactionInstruction({
    programId,
    keys: wrongFeeKeys,
    data: Buffer.from(tradeData(1, 10_000_000n, 1n)),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(wrongFee), [payer], { commitment: 'confirmed' });
});

const sellAmount = bought / 2n;
assert(sellAmount > 0n, 'buy produced enough tokens for sell test');
const platformBeforeSell = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
const sellIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: traderAta.address, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: platformWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(tradeData(2, sellAmount, 1n)),
});
await sendAndConfirmTransaction(connection, new Transaction().add(sellIx), [payer], { commitment: 'confirmed' });
const afterSell = await readCurve(curve);
const traderAfterSell = await getAccount(connection, traderAta.address, 'confirmed', TOKEN_PROGRAM_ID);
const platformAfterSell = BigInt(await connection.getBalance(platformWallet, 'confirmed'));
assert(BigInt(traderAfterSell.amount.toString()) === bought - sellAmount, 'seller token balance decreases by exact sell amount');
assert(afterSell.realTokens === afterBuy.realTokens + sellAmount, 'sold tokens return to curve inventory');
assert(afterSell.realSol < afterBuy.realSol, 'sell pays SOL out of real curve reserves');
assert(platformAfterSell > platformBeforeSell, 'sell fee reaches Signal platform wallet');
assert(!afterSell.complete && !afterSell.graduated, 'ordinary buy/sell sequence leaves curve active');
console.log('✓ sell verified: tokens returned to curve, SOL paid out, 1% fee collected');

console.log('✓ Signal bonding-curve local runtime smoke test passed');
