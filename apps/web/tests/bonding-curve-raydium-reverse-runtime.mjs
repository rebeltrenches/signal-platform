import fs from 'node:fs';
import process from 'node:process';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
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
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const SWAP_BASE_INPUT_DISCRIMINATOR = Uint8Array.from([143, 190, 90, 218, 196, 30, 51, 222]);
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
function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function decodeState(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  assert(bytes.length === 160 && bytes[0] === 2, 'valid Signal curve state');
  return {
    graduated: bytes[3] !== 0,
    mint: new PublicKey(bytes.slice(4, 36)),
    graduationPool: new PublicKey(bytes.slice(117, 149)),
  };
}

// The preceding Raydium runtime test creates and trades a graduated pool on
// this same validator. Find it from Signal program state so this test proves
// that the resulting market can trade in the opposite direction too.
const curveAccounts = await connection.getProgramAccounts(programId, {
  filters: [{ dataSize: 160 }],
  commitment: 'confirmed',
});
let target = null;
for (const account of curveAccounts) {
  const state = decodeState(account.account.data);
  if (state.graduated && !state.graduationPool.equals(PublicKey.default)) {
    target = state;
    break;
  }
}
assert(target, 'a graduated Signal curve is available');

const mint = target.mint;
const pool = target.graduationPool;
const token0 = keyLess(mint, WSOL_MINT) ? mint : WSOL_MINT;
const token1 = keyLess(mint, WSOL_MINT) ? WSOL_MINT : mint;
const rayAuthority = pda([encoder.encode('vault_and_lp_mint_auth_seed')], RAYDIUM_CPMM_PROGRAM);
const vault0 = pda([encoder.encode('pool_vault'), pool.toBytes(), token0.toBytes()], RAYDIUM_CPMM_PROGRAM);
const vault1 = pda([encoder.encode('pool_vault'), pool.toBytes(), token1.toBytes()], RAYDIUM_CPMM_PROGRAM);
const observation = pda([encoder.encode('observation'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);
const lpMint = pda([encoder.encode('pool_lp_mint'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);
const payerToken = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
const payerWsol = getAssociatedTokenAddressSync(WSOL_MINT, payer.publicKey, false, TOKEN_PROGRAM_ID);

const poolInfo = await connection.getAccountInfo(pool, 'confirmed');
assert(poolInfo?.owner.equals(RAYDIUM_CPMM_PROGRAM), 'graduation pool is owned by Raydium CPMM');
const tokenBefore = await getAccount(connection, payerToken, 'confirmed', TOKEN_PROGRAM_ID);
const wsolBefore = await getAccount(connection, payerWsol, 'confirmed', TOKEN_PROGRAM_ID);
const wsolAmount = BigInt(wsolBefore.amount.toString());
assert(wsolAmount > 1n, 'forward Raydium swap produced WSOL for the reverse test');
const swapIn = wsolAmount / 2n;
assert(swapIn > 0n, 'reverse WSOL input is non-zero');

const inputVault = token0.equals(WSOL_MINT) ? vault0 : vault1;
const outputVault = token0.equals(WSOL_MINT) ? vault1 : vault0;
const swapData = concat(SWAP_BASE_INPUT_DISCRIMINATOR, u64(swapIn), u64(1n));
const swapIx = new TransactionInstruction({
  programId: RAYDIUM_CPMM_PROGRAM,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: rayAuthority, isSigner: false, isWritable: false },
    { pubkey: RAYDIUM_AMM_CONFIG, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: payerWsol, isSigner: false, isWritable: true },
    { pubkey: payerToken, isSigner: false, isWritable: true },
    { pubkey: inputVault, isSigner: false, isWritable: true },
    { pubkey: outputVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: observation, isSigner: false, isWritable: true },
  ],
  data: Buffer.from(swapData),
});

const signature = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [payer], { commitment: 'confirmed' });
const tokenAfter = await getAccount(connection, payerToken, 'confirmed', TOKEN_PROGRAM_ID);
const wsolAfter = await getAccount(connection, payerWsol, 'confirmed', TOKEN_PROGRAM_ID);
assert(wsolAmount - BigInt(wsolAfter.amount.toString()) === swapIn, 'Raydium took the exact reverse WSOL input');
assert(BigInt(tokenAfter.amount.toString()) > BigInt(tokenBefore.amount.toString()), 'Raydium paid token output to the trader');
const lpMintAfter = await getMint(connection, lpMint, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(lpMintAfter.supply.toString()) === 0n, 'reverse trading does not recreate withdrawable LP supply');

console.log(`✓ graduated Raydium pool executed a real WSOL→token swap: ${signature}`);
console.log('✓ post-graduation Raydium market is tradeable in both directions');
