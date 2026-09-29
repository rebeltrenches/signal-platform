import fs from 'node:fs';
import process from 'node:process';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';

const RPC = process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899';
const KEYPAIR_PATH = process.env.SIGNAL_RUNTIME_PAYER;
const PROGRAM_ID_TEXT = process.env.SIGNAL_RUNTIME_PROGRAM_ID;
if (!KEYPAIR_PATH || !PROGRAM_ID_TEXT) throw new Error('SIGNAL_RUNTIME_PAYER and SIGNAL_RUNTIME_PROGRAM_ID are required.');

const connection = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))));
const programId = new PublicKey(PROGRAM_ID_TEXT);
const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_AMM_CONFIG = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');
const RAYDIUM_CREATE_POOL_FEE = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const encoder = new TextEncoder();

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function pda(seeds, owner) { return PublicKey.findProgramAddressSync(seeds, owner)[0]; }
function keyLess(left, right) {
  const a = left.toBytes();
  const b = right.toBytes();
  for (let i = 0; i < 32; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
function decodeState(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  assert(bytes.length === 160 && bytes[0] === 2, 'valid Signal curve state');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    complete: bytes[2] !== 0,
    graduated: bytes[3] !== 0,
    mint: new PublicKey(bytes.slice(4, 36)),
    realTokens: view.getBigUint64(84, true),
    realSol: view.getBigUint64(92, true),
    totalSupply: view.getBigUint64(100, true),
    initialRealTokens: view.getBigUint64(108, true),
    graduationPool: new PublicKey(bytes.slice(117, 149)),
  };
}

// The preceding completion-runtime test deliberately leaves one completed,
// ungraduated curve on this same local validator. Find it from program state
// instead of passing hidden test state between scripts.
const curveAccounts = await connection.getProgramAccounts(programId, { filters: [{ dataSize: 160 }], commitment: 'confirmed' });
let target = null;
for (const account of curveAccounts) {
  const state = decodeState(account.account.data);
  if (state.complete && !state.graduated && state.realTokens === 0n && state.realSol > 0n) {
    target = { curve: account.pubkey, state };
    break;
  }
}
assert(target, 'a completed curve is available for Raydium graduation');
const { curve, state } = target;
const mint = state.mint;
const curveVault = getAssociatedTokenAddressSync(mint, curve, true, TOKEN_PROGRAM_ID);
const migration = pda([encoder.encode('migration-authority'), mint.toBytes()], programId);
const pool = pda([encoder.encode('raydium-pool'), mint.toBytes()], programId);
const migrationToken = getAssociatedTokenAddressSync(mint, migration, true, TOKEN_PROGRAM_ID);
const migrationWsol = getAssociatedTokenAddressSync(WSOL_MINT, migration, true, TOKEN_PROGRAM_ID);
const token0 = keyLess(mint, WSOL_MINT) ? mint : WSOL_MINT;
const token1 = keyLess(mint, WSOL_MINT) ? WSOL_MINT : mint;
const rayAuthority = pda([encoder.encode('vault_and_lp_mint_auth_seed')], RAYDIUM_CPMM_PROGRAM);
const lpMint = pda([encoder.encode('pool_lp_mint'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);
const lpAta = getAssociatedTokenAddressSync(lpMint, migration, true, TOKEN_PROGRAM_ID);
const vault0 = pda([encoder.encode('pool_vault'), pool.toBytes(), token0.toBytes()], RAYDIUM_CPMM_PROGRAM);
const vault1 = pda([encoder.encode('pool_vault'), pool.toBytes(), token1.toBytes()], RAYDIUM_CPMM_PROGRAM);
const observation = pda([encoder.encode('observation'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);

for (const [label, address, owner] of [
  ['Raydium CPMM program', RAYDIUM_CPMM_PROGRAM, null],
  ['Raydium AMM config', RAYDIUM_AMM_CONFIG, RAYDIUM_CPMM_PROGRAM],
  ['Raydium create-pool fee receiver', RAYDIUM_CREATE_POOL_FEE, TOKEN_PROGRAM_ID],
  ['wrapped SOL mint', WSOL_MINT, TOKEN_PROGRAM_ID],
]) {
  const info = await connection.getAccountInfo(address, 'confirmed');
  assert(info, `${label} fixture is loaded`);
  if (owner) assert(info.owner.equals(owner), `${label} has expected owner`);
  if (label === 'Raydium CPMM program') assert(info.executable, 'Raydium CPMM fixture is executable');
}

const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: migration, isSigner: false, isWritable: true },
    { pubkey: migrationToken, isSigner: false, isWritable: true },
    { pubkey: migrationWsol, isSigner: false, isWritable: true },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: RAYDIUM_CPMM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: RAYDIUM_AMM_CONFIG, isSigner: false, isWritable: false },
    { pubkey: rayAuthority, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: lpAta, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: RAYDIUM_CREATE_POOL_FEE, isSigner: false, isWritable: true },
    { pubkey: observation, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([3]),
});

const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  instruction,
);
const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
console.log(`Raydium graduation transaction: ${signature}`);

const afterInfo = await connection.getAccountInfo(curve, 'confirmed');
assert(afterInfo?.owner.equals(programId), 'Signal curve remains program-owned');
const after = decodeState(afterInfo.data);
assert(after.complete && after.graduated, 'curve is marked graduated');
assert(after.realSol === 0n, 'real SOL reserve is fully migrated');
assert(after.realTokens === 0n, 'sale inventory stays exhausted');
assert(after.graduationPool.equals(pool), 'curve records exact Raydium pool');

const poolInfo = await connection.getAccountInfo(pool, 'confirmed');
assert(poolInfo?.owner.equals(RAYDIUM_CPMM_PROGRAM), 'Raydium owns the new pool state');
assert(poolInfo.data.length > 0, 'Raydium pool state was initialized');
const finalCurveVault = await getAccount(connection, curveVault, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(finalCurveVault.amount.toString()) === 0n, 'graduation token reserve left the Signal curve vault');
const poolVault0 = await getAccount(connection, vault0, 'confirmed', TOKEN_PROGRAM_ID);
const poolVault1 = await getAccount(connection, vault1, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(poolVault0.amount.toString()) > 0n && BigInt(poolVault1.amount.toString()) > 0n, 'Raydium pool received both sides of liquidity');
const lpState = await getAccount(connection, lpAta, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(lpState.amount.toString()) === 0n, 'all withdrawable LP tokens held by migration PDA were burned');
const lpMintState = await getMint(connection, lpMint, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(lpMintState.supply.toString()) === 0n, 'no withdrawable LP token supply remains after burn');

console.log(`✓ Raydium CPMM pool created at ${pool.toBase58()}`);
console.log('✓ curve SOL + reserved tokens migrated into Raydium');
console.log('✓ migration LP tokens burned; liquidity is not withdrawable by creator or Signal');
console.log('✓ Signal → Raydium graduation runtime test passed');
