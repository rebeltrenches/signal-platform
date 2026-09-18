# contracts/solana — starting point for Stage 6, now implemented in packages/blockchain

Starting point: the Token-2022 `TransferFeeConfig` approach from the
earlier single-chain build's `1-create-token.ts` — same audited-extension
mechanism, same single-authority model (the token's own creator holds
mint authority, transfer-fee-config authority, and withdraw-withheld
authority, receiving 100% of the 3% Transfer Fee — no Signal platform
fee, no holder-rewards pool, confirmed 2026-09-17 as the final state
after multiple reversals; see docs/ARCHITECTURE.md ADR-0009 for the full
history), now wrapped behind `SolanaAdapter` in
`packages/blockchain/src/solana` instead of run as a standalone script.
That package also gained a capability the original standalone scripts
didn't need in quite this shape: `buildHarvestAndWithdrawTransactions`,
so a creator can collect their own accumulated fee as an in-app action
rather than a separate CLI tool. Anchor is added at this stage only if
program-side logic beyond what Token-2022 already provides turns out to
be needed (e.g. custom bonding-curve accounts at Stage 8) — no Anchor
program exists yet because nothing has needed one yet.
