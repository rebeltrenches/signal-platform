// Test stub for @solana/spl-token — see web3.js in this same directory
// for what this class of stub does and doesn't prove.
export const TOKEN_2022_PROGRAM_ID = 'TOKEN_2022_STUB';
export const ExtensionType = { TransferFeeConfig: 'TransferFeeConfig' };
export function getMintLen() { return 234; }
export function unpackAccount(pubkey, account) { return account.__unpacked; }
export function getTransferFeeAmount(unpacked) { return { withheldAmount: unpacked.withheld }; }
export function createHarvestWithheldTokensToMintInstruction(mint, batch) {
  window.__t.harvestCalls = window.__t.harvestCalls || [];
  window.__t.harvestCalls.push({ mint: mint.toBase58(), batchSize: batch.length });
  return { type: 'harvest' };
}
export function getAssociatedTokenAddressSync(mint, owner) {
  return { toBase58: () => 'ATA_FOR_' + owner.toBase58() };
}
export function createAssociatedTokenAccountInstruction() { return { type: 'createATA' }; }
export function createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint) {
  return { type: 'createATA', owner: owner.toBase58() };
}
export function createWithdrawWithheldTokensFromMintInstruction(mint, destAta, authority) {
  window.__t.withdrawCall = { mint: mint.toBase58(), destAta: destAta.toBase58(), authority: authority.toBase58() };
  return { type: 'withdraw' };
}
export function createInitializeTransferFeeConfigInstruction(mint, cfgAuth, withdrawAuth, bps, maxFee) {
  window.__t.transferFeeConfigCall = {
    mint: mint.toBase58(),
    cfgAuth: cfgAuth.toBase58(),
    withdrawAuth: withdrawAuth.toBase58(),
    bps,
    maxFee: maxFee.toString(),
  };
  return { type: 'initTransferFeeConfig' };
}
export function createInitializeMintInstruction(mint, decimals, mintAuth) {
  window.__t.initMintCall = { decimals, mintAuth: mintAuth.toBase58() };
  return { type: 'initMint' };
}
export function createMintToInstruction(mint, ata, authority, amount) {
  window.__t.mintToCall = { authority: authority.toBase58(), amount: amount.toString() };
  return { type: 'mintTo' };
}
