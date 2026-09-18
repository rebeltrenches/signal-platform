# packages/database/tests

`schema-smoke.test.ts` tested the double-claim-prevention invariant on
`HolderReward`/`HolderRewardClaim`. Those models have been removed again
2026-09-17 (final confirmed state: 100% of the transfer fee goes to the
token's own creator, no holder-rewards pool) — this test went with them,
same as the last time this fee model was 100%-creator. See
docs/ROADMAP.md Stage 6 for the complete back-and-forth history.

No replacement test exists for `TransactionTaxConfiguration`'s simpler
current shape (`enabled` + `totalBps`) — the real correctness guarantees
for the current model live in `packages/utils/tests/tax.test.ts` instead.
