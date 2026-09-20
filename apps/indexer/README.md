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
- Page checkpoints are written only after the page is processed, making
  crash replay safe because metadata is upserted and holders are replaced.

## Run

Required environment: `DATABASE_URL` and `SOLANA_RPC_URL`.

One pass: `pnpm --filter @launchpad/indexer solana:once`

Continuous refresh: `pnpm --filter @launchpad/indexer solana`

`INDEXER_INTERVAL_MS` defaults to 60000 and cannot be below 1000.

### Checkpoint scope

This first slice intentionally uses an in-process checkpoint store while
the refresh behavior is proven against a real RPC. A process restart
therefore begins a fresh scan. Refresh writes are idempotent snapshots,
so this is safe, but it is not yet the final persistent per-chain restart
checkpoint required by the full Stage 11 acceptance criteria. Persistent
checkpoints should follow the first live-RPC verification.
