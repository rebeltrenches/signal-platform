// Bundle entry: @solana/spl-token at the exact version pinned in
// apps/web/package.json, served as /client/vendor/spl-token.js. It
// shares one copy of @solana/web3.js with solana-web3.js through a
// split chunk, so their PublicKey and Transaction classes are the same.
export * from '@solana/spl-token';
