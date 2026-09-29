import fs from 'node:fs';
import process from 'node:process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';

const RPC = process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899';
const KEYPAIR_PATH = process.env.SIGNAL_RUNTIME_PAYER;
const PROGRAM_ID_TEXT = process.env.SIGNAL_RUNTIME_PROGRAM_ID;
if (!KEYPAIR_PATH || !PROGRAM_ID_TEXT) throw new Error('SIGNAL_RUNTIME_PAYER and SIGNAL_RUNTIME_PROGRAM_ID are required.');

const connection = new Connection(RPC, 'confirmed');
Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))));
const programId = new PublicKey(PROGRAM_ID_TEXT);
const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const encoder = new TextEncoder();

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function pda(seeds, owner) { return PublicKey.findProgramAddressSync(seeds, owner)[0]; }
function decodeState(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  assert(bytes.length === 160 && bytes[0] === 2, 'valid Signal curve state');
  return {
    graduated: bytes[3] !== 0,
    mint: new PublicKey(bytes.slice(4, 36)),
    graduationPool: new PublicKey(bytes.slice(117, 149)),
  };
}

const curves = await connection.getProgramAccounts(programId, { filters: [{ dataSize: 160 }], commitment: 'confirmed' });
let target = null;
for (const account of curves) {
  const state = decodeState(account.account.data);
  if (state.graduated && !state.graduationPool.equals(PublicKey.default)) {
    target = { curve: account.pubkey, state };
    break;
  }
}
assert(target, 'a graduated Signal curve is available for leftover audit');

const { curve, state } = target;
const mint = state.mint;
const migration = pda([encoder.encode('migration-authority'), mint.toBytes()], programId);
const migrationToken = getAssociatedTokenAddressSync(mint, migration, true, TOKEN_PROGRAM_ID);
const migrationWsol = getAssociatedTokenAddressSync(WSOL_MINT, migration, true, TOKEN_PROGRAM_ID);
const lpMint = pda([encoder.encode('pool_lp_mint'), state.graduationPool.toBytes()], RAYDIUM_CPMM_PROGRAM);
const migrationLp = getAssociatedTokenAddressSync(lpMint, migration, true, TOKEN_PROGRAM_ID);
const curveVault = getAssociatedTokenAddressSync(mint, curve, true, TOKEN_PROGRAM_ID);

const [curveInfo, migrationInfo] = await Promise.all([
  connection.getAccountInfo(curve, 'confirmed'),
  connection.getAccountInfo(migration, 'confirmed'),
]);
assert(curveInfo?.owner.equals(programId), 'graduated curve stays Signal-program-owned');
const curveRent = await connection.getMinimumBalanceForRentExemption(curveInfo.data.length, 'confirmed');
assert(curveInfo.lamports === curveRent, `curve retains only its rent floor (${curveInfo.lamports} vs ${curveRent})`);
assert(!migrationInfo || migrationInfo.lamports === 0, `migration authority has no loose lamports (${migrationInfo?.lamports ?? 0})`);

const curveVaultState = await getAccount(connection, curveVault, 'confirmed', TOKEN_PROGRAM_ID);
const migrationTokenState = await getAccount(connection, migrationToken, 'confirmed', TOKEN_PROGRAM_ID);
const migrationWsolState = await getAccount(connection, migrationWsol, 'confirmed', TOKEN_PROGRAM_ID);
const migrationLpState = await getAccount(connection, migrationLp, 'confirmed', TOKEN_PROGRAM_ID);
assert(BigInt(curveVaultState.amount.toString()) === 0n, 'curve token vault has no tokens after graduation');
assert(BigInt(migrationTokenState.amount.toString()) === 0n, 'temporary migration token ATA has no tokens');
assert(BigInt(migrationWsolState.amount.toString()) === 0n, 'temporary migration WSOL ATA has no WSOL');
assert(BigInt(migrationLpState.amount.toString()) === 0n, 'temporary migration LP ATA has no LP tokens');

const tempAddresses = [migrationToken, migrationWsol, migrationLp];
let temporaryRent = 0;
for (const address of tempAddresses) {
  const info = await connection.getAccountInfo(address, 'confirmed');
  assert(info?.owner.equals(TOKEN_PROGRAM_ID), `${address.toBase58()} remains a token account only`);
  const rent = await connection.getMinimumBalanceForRentExemption(info.data.length, 'confirmed');
  assert(info.lamports === rent, `${address.toBase58()} contains only rent-exempt lamports, not spendable migration dust`);
  temporaryRent += info.lamports;
}

console.log('✓ no token, WSOL, LP-token or loose-lamport value remains in Signal migration custody');
console.log(`ℹ ${temporaryRent} lamports remain solely as rent in three empty temporary token accounts; cleanup can reclaim this after graduation`);
console.log(`✓ graduated curve account retains exactly its ${curveRent}-lamport rent floor`);
