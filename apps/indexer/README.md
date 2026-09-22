# apps/indexer — Stage 11, first safe slice

The first Stage 11 slice refreshes already-registered Solana tokens using
the existing `SolanaAdapter` read methods and existing `TokenIndexer`.
It writes only blockchain-derived token metadata and holder snapshots
through the existing token repository.

The same paged cycle also scans each distinct registered creator wallet
for explicit System Program SOL transfers and stores only those observed
funding relationships with their transaction signature. A transfer is never
treated as evidence of common ownership, identity, intent, or risk.
Incoming sources are followed breadth-first to three levels, with a hard cap
of 50 scanned wallets per creator. Cycles are ignored and outgoing recipients
are never expanded, preventing an unbounded wallet-graph crawl.

## Deliberate limits

- No fabricated trades, prices, liquidity, or wallet relationships.
- No ownership/scammer inference.
- No transaction signing or blockchain writes.
- A failed token refresh is logged and does not fabricate fallback data.
- Page checkpoints are persisted to PostgreSQL only after the page is processed,
  making crash replay safe because metadata is upserted and holders are replaced.

## Run

Required environment: `DATABASE_URL` and `SOLANA_RPC_URL`.

One pass: `pnpm --filter @launchpad/indexer solana:once`

Continuous refresh: `pnpm --filter @launchpad/indexer solana`

`INDEXER_INTERVAL_MS` defaults to 60000 and cannot be below 1000.

### Checkpoint scope

Checkpoint cursors are stored in PostgreSQL in the `IndexerCheckpoint` model.
A process restart resumes from the last completed page. If a process dies before
the checkpoint write, that page is replayed; refresh writes are idempotent
snapshots, so replay does not create duplicate holder rows.

The continuous runner awaits each complete cycle before sleeping for the next
interval, so slow RPC/database cycles cannot overlap.


## Operations and observability

The runner records cycle state in PostgreSQL (`IndexerRunState`), including
last start/completion/failure, attempted/refreshed/failed counts, and the last
cycle-level error. The API exposes this read-only at `GET /health/indexer`.

A temporary holder RPC failure is not represented as an empty holder list:
`SolanaAdapter.getTopHolders` propagates the failure so the indexer skips the
write and preserves the last known-good holder snapshot.

SIGTERM/SIGINT stop new cycles; the current operation is allowed to finish and
the Prisma client is disconnected before process exit.
