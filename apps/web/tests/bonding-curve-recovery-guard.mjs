import { existsSync, readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/client/launch-solana-curve.js', import.meta.url), 'utf8');
const tradeRouter = readFileSync(new URL('../src/client/trade-router.js', import.meta.url), 'utf8');

function mustContain(text, label) {
  if (!source.includes(text)) throw new Error(`Recovery guard missing: ${label}`);
}

mustContain('async verifyRecoveredLaunch(mint, expected)', 'dedicated recovered-launch verifier');
mustContain('mintInfo.mintAuthority !== null || mintInfo.freezeAuthority !== null', 'revoked mint/freeze authority check');
mustContain('BigInt(mintInfo.supply.toString()) !== expected.rawSupply', 'mint supply check');
mustContain('!curveInfo || !curveInfo.owner.equals(pid)', 'curve program-owner check');
mustContain('!state.mint.equals(mint)', 'curve mint binding');
mustContain('!state.creator.equals(expected.creator)', 'curve creator binding');
mustContain('state.totalSupply !== expected.rawSupply', 'curve supply binding');
mustContain('state.initialRealTokenReserves !== expectedInitialReal', '79.31% initial inventory binding');
mustContain('!vaultInfo.owner.equals(curve) || !vaultInfo.mint.equals(mint)', 'vault owner/mint binding');
mustContain('const expectedVaultAmount = state.realTokenReserves + graduationReserve;', 'live vault balance consistency');
mustContain('state.graduationPool.equals(ZERO_PUBKEY)', 'graduated pool evidence');
mustContain('Immutable Signal launch metadata is missing or owned by an unexpected program.', 'missing metadata fails closed');
mustContain('await this.verifyMetadata(mint, { name: expected.name, symbol: expected.symbol, uri: expected.metadataUri });', 'immutable metadata binding');
mustContain('const verified = await flow.verifyRecoveredLaunch(mint, {', 'listing path always invokes verifier');
mustContain('pending.stage === "listing" ? "Verify and finish listing"', 'listing recovery is explicitly verification-gated');
mustContain('if (beforeSubmit) beforeSubmit();', 'recovery state hook runs before transaction submission');
mustContain('stage: "mint"', 'mint recovery stage is persisted before submission');
mustContain('savePending(pending);', 'pending launch is stored for recovery');

const listingIndex = source.indexOf('status.textContent = "On-chain curve, custody and immutable metadata verified. Finishing Signal listing…";');
const verifyIndex = source.lastIndexOf('const verified = await flow.verifyRecoveredLaunch', listingIndex);
const listIndex = source.indexOf('await listOnSignal(pending, status', listingIndex);
if (!(verifyIndex >= 0 && listingIndex > verifyIndex && listIndex > listingIndex)) {
  throw new Error('Recovery listing must happen only after the on-chain verification call.');
}

// A failed/cancelled permissionless graduation must be retryable on the same
// page. A once-only click listener combined with re-enabling the button makes
// the second click a no-op, which is especially confusing after a wallet
// cancellation or transient RPC failure.
if (tradeRouter.includes('}, { once: true });')) {
  throw new Error('Raydium graduation click handler must remain attached after a failed attempt.');
}
if (!tradeRouter.includes('button.disabled = false;')) {
  throw new Error('Raydium graduation failure path must re-enable the retry button.');
}

// The pre-curve launcher used to mint the complete supply directly to the
// creator wallet. It must not exist in source or in the built public client
// directory: even an unreferenced browser module could otherwise be manually
// imported and revive the old launch path.
if (existsSync(new URL('../src/client/launch-solana.js', import.meta.url))) {
  throw new Error('Legacy full-supply-to-creator launcher exists in source.');
}
if (existsSync(new URL('../dist/client/launch-solana.js', import.meta.url))) {
  throw new Error('Legacy full-supply-to-creator launcher was shipped in the public build.');
}

console.log('✓ recovered mint, curve, creator, supply, authorities and vault are re-verified');
console.log('✓ immutable metadata is re-verified and missing metadata fails closed');
console.log('✓ mint address is persisted after wallet approval and before network submission');
console.log('✓ listing recovery cannot run before on-chain verification');
console.log('✓ failed/cancelled Raydium graduation remains retryable without a page reload');
console.log('✓ legacy full-supply creator launcher is absent from source and public build');
console.log('✓ Signal bonding-curve recovery integrity guard passed');
