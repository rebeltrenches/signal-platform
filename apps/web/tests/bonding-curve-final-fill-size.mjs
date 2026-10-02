import assert from 'node:assert/strict';
import * as web3 from '@solana/web3.js';
import * as splToken from '@solana/spl-token';

const MAX_LEGACY_TRANSACTION_BYTES = 1232;
const RAYDIUM_CPMM_PROGRAM = new web3.PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_AMM_CONFIG = new web3.PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');
const RAYDIUM_CREATE_POOL_FEE = new web3.PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');
const WSOL_MINT = new web3.PublicKey('So11111111111111111111111111111111111111112');
const SIGNAL_PLATFORM_WALLET = web3.Keypair.generate().publicKey;
const SIGNAL_CURVE_PROGRAM = web3.Keypair.generate().publicKey;
const COMPUTE_PRICE = 50_000;
const GRADUATION_COMPUTE_LIMIT = 1_400_000;
const encoder = new TextEncoder();

function pda(seeds, programId) {
  return web3.PublicKey.findProgramAddressSync(seeds, programId)[0];
}
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
function tradeData(op, a, b) {
  const out = new Uint8Array(17);
  out[0] = op;
  out.set(u64(a), 1);
  out.set(u64(b), 9);
  return out;
}

const trader = web3.Keypair.generate();
const mint = web3.Keypair.generate().publicKey;
const curve = pda([encoder.encode('bonding-curve'), mint.toBytes()], SIGNAL_CURVE_PROGRAM);
const curveVault = splToken.getAssociatedTokenAddressSync(mint, curve, true, splToken.TOKEN_PROGRAM_ID);
const traderAta = splToken.getAssociatedTokenAddressSync(mint, trader.publicKey, false, splToken.TOKEN_PROGRAM_ID);

const migration = pda([encoder.encode('migration-authority'), mint.toBytes()], SIGNAL_CURVE_PROGRAM);
const pool = pda([encoder.encode('raydium-pool'), mint.toBytes()], SIGNAL_CURVE_PROGRAM);
const migrationToken = splToken.getAssociatedTokenAddressSync(mint, migration, true, splToken.TOKEN_PROGRAM_ID);
const migrationWsol = splToken.getAssociatedTokenAddressSync(WSOL_MINT, migration, true, splToken.TOKEN_PROGRAM_ID);
const token0 = keyLess(mint, WSOL_MINT) ? mint : WSOL_MINT;
const token1 = keyLess(mint, WSOL_MINT) ? WSOL_MINT : mint;
const rayAuthority = pda([encoder.encode('vault_and_lp_mint_auth_seed')], RAYDIUM_CPMM_PROGRAM);
const lpMint = pda([encoder.encode('pool_lp_mint'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);
const lpAta = splToken.getAssociatedTokenAddressSync(lpMint, migration, true, splToken.TOKEN_PROGRAM_ID);
const vault0 = pda([encoder.encode('pool_vault'), pool.toBytes(), token0.toBytes()], RAYDIUM_CPMM_PROGRAM);
const vault1 = pda([encoder.encode('pool_vault'), pool.toBytes(), token1.toBytes()], RAYDIUM_CPMM_PROGRAM);
const observation = pda([encoder.encode('observation'), pool.toBytes()], RAYDIUM_CPMM_PROGRAM);

const buy = new web3.TransactionInstruction({
  programId: SIGNAL_CURVE_PROGRAM,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault, isSigner: false, isWritable: true },
    { pubkey: traderAta, isSigner: false, isWritable: true },
    { pubkey: trader.publicKey, isSigner: true, isWritable: true },
    { pubkey: SIGNAL_PLATFORM_WALLET, isSigner: false, isWritable: true },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: tradeData(1, 1_000_000_000n, 1n),
});

const graduate = new web3.TransactionInstruction({
  programId: SIGNAL_CURVE_PROGRAM,
  keys: [
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curveVault, isSigner: false, isWritable: true },
    { pubkey: trader.publicKey, isSigner: true, isWritable: true },
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
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: splToken.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: Uint8Array.of(3),
});

const tx = new web3.Transaction({
  feePayer: trader.publicKey,
  recentBlockhash: web3.Keypair.generate().publicKey.toBase58(),
}).add(
  web3.ComputeBudgetProgram.setComputeUnitLimit({ units: GRADUATION_COMPUTE_LIMIT }),
  web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
  splToken.createAssociatedTokenAccountIdempotentInstruction(
    trader.publicKey,
    traderAta,
    trader.publicKey,
    mint,
    splToken.TOKEN_PROGRAM_ID,
  ),
  buy,
  graduate,
  graduate,
);

let serialized;
try {
  serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
} catch (error) {
  throw new Error(`Final-fill legacy transaction cannot be serialized: ${error.message}`);
}

console.log(`two-stage final-fill legacy transaction size: ${serialized.length}/${MAX_LEGACY_TRANSACTION_BYTES} bytes`);
assert.ok(
  serialized.length <= MAX_LEGACY_TRANSACTION_BYTES,
  `final-fill transaction is ${serialized.length} bytes, above Solana's ${MAX_LEGACY_TRANSACTION_BYTES}-byte limit`,
);
