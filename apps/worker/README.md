# apps/worker — no real content (again)

`src/harvest-and-distribute.ts` existed to run Signal's side of a
platform-fee harvest/split/distribute pipeline. Removed again 2026-09-17
(final confirmed state: 100% of the transfer fee goes to the token's own
creator, no Signal platform fee, no holder-rewards pool) — see
docs/ROADMAP.md Stage 6 for the complete back-and-forth history.

Under the current model, Signal has no operational role in fee
collection at all — the token's own creator harvests and withdraws their
own fee, from their own wallet, via
`SolanaAdapter.buildHarvestAndWithdrawTransactions` (a UI action, not a
backend job).

This directory has no real content: queue-based background jobs for
things Signal genuinely does operate — alert evaluation, notification
delivery, indexing — once Stage 11/15 are reached.
