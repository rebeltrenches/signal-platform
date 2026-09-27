// Bundle entry: @solana/web3.js at the exact version pinned in
// apps/web/package.json, served from our own origin as
// /client/vendor/solana-web3.js (see scripts/build.tsx) instead of
// being loaded from a CDN at runtime (audit item C4).
export * from '@solana/web3.js';
