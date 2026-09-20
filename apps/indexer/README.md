# apps/indexer — Stage 11, first safe slice

The first Stage 11 slice refreshes already-registered Solana tokens using
the existing `SolanaAdapter` read methods and existing `TokenIndexer`.
It writes only blockchain-derived token metadata and holder snapshots
through the existing token repository.

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
