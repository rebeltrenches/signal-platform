// Injected into the wallet bundles (scripts/build.tsx): @solana/spl-token
// and its layout helpers use Node's global `Buffer`, which browsers don't
// have. esbuild rewrites those free references to this export (the same
// `buffer` package @solana/web3.js already uses) without adding a global.
export { Buffer } from 'buffer';
