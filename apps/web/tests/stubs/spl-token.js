// Test stub for @solana/spl-token — see web3.js in this same directory
// for what this class of stub does and doesn't prove.
export const MINT_SIZE = 82;
export const TOKEN_PROGRAM_ID = 'TOKEN_PROGRAM_STUB';
export function getAssociatedTokenAddressSync(mint, owner) {
  return { toBase58: () => 'ATA_FOR_' + owner.toBase58(), toJSON: () => 'ATA_FOR_' + owner.toBase58() };
}
export function createAssociatedTokenAccountInstruction() { return { type: 'createATA' }; }
export function createInitializeMintInstruction(mint, decimals, mintAuth) {
  window.__t.initMintCalls = window.__t.initMintCalls || [];
  window.__t.initMintCalls.push({ mint: mint.toBase58(), decimals, mintAuth: mintAuth.toBase58() });
  return { type: 'initMint', decimals };
}
export function createMintToInstruction(mint, ata, authority, amount) {
  window.__t.mintToCalls = window.__t.mintToCalls || [];
  window.__t.mintToCalls.push({ mint: mint.toBase58(), authority: authority.toBase58(), amount: amount.toString() });
  return { type: 'mintTo', amount: amount.toString() };
}
