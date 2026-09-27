// Test stub for @solana/spl-token — see web3.js in this same directory
// for what this class of stub does and doesn't prove.
import { stubInstruction } from './solana-web3.js';

export const MINT_SIZE = 82;
export const TOKEN_PROGRAM_ID = 'TOKEN_PROGRAM_STUB';
const ATA_PROGRAM_ID = 'ATA_PROGRAM_STUB';
export function getAssociatedTokenAddressSync(mint, owner) {
  return { toBase58: () => 'ATA_FOR_' + owner.toBase58(), toJSON: () => 'ATA_FOR_' + owner.toBase58() };
}
export function createAssociatedTokenAccountInstruction() { return stubInstruction(ATA_PROGRAM_ID, 'createATA'); }
export function createInitializeMintInstruction(mint, decimals, mintAuth) {
  window.__t.initMintCalls = window.__t.initMintCalls || [];
  window.__t.initMintCalls.push({ mint: mint.toBase58(), decimals, mintAuth: mintAuth.toBase58() });
  return stubInstruction(TOKEN_PROGRAM_ID, 'initMint', { decimals });
}
export function createMintToInstruction(mint, ata, authority, amount) {
  window.__t.mintToCalls = window.__t.mintToCalls || [];
  window.__t.mintToCalls.push({ mint: mint.toBase58(), authority: authority.toBase58(), amount: amount.toString() });
  return stubInstruction(TOKEN_PROGRAM_ID, 'mintTo', { amount: amount.toString() });
}
export const AuthorityType = { MintTokens: 0, FreezeAccount: 1 };
export function createSetAuthorityInstruction(account, currentAuthority, authorityType, newAuthority) {
  window.__t.setAuthorityCalls = window.__t.setAuthorityCalls || [];
  window.__t.setAuthorityCalls.push({
    account: account.toBase58(),
    currentAuthority: currentAuthority.toBase58(),
    authorityType,
    newAuthority: newAuthority === null ? null : newAuthority.toBase58(),
  });
  return stubInstruction(TOKEN_PROGRAM_ID, 'setAuthority', { authorityType, newAuthority: newAuthority === null ? null : 'SET' });
}
// Read-back of the mint. Test knobs on window.__t:
//   mintReadFails        - every read throws (RPC unavailable)
//   mintAuthorityAfter   - base58 string reported as the remaining mint authority
//   existingMintDecimals - decimals reported for the mint (default 6)
// Otherwise reports what the stubbed transactions would have produced.
export async function getMint(connection, address) {
  window.__t.getMintCalls = (window.__t.getMintCalls || 0) + 1;
  if (window.__t.mintReadFails) throw new Error('stub: RPC unavailable');
  const minted = (window.__t.mintToCalls || []).filter((c) => c.mint === address.toBase58()).at(-1);
  return {
    address,
    mintAuthority: window.__t.mintAuthorityAfter ? { toBase58: () => window.__t.mintAuthorityAfter } : null,
    supply: BigInt(minted ? minted.amount : 0),
    decimals: window.__t.existingMintDecimals ?? 6,
  };
}
