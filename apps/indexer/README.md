# apps/indexer — Stage 11, not started

Planned: background indexers per chain, writing into the `Holder`,
`WalletActivity`, `BlockchainEvent`, and `TokenMetadata` tables. Must
handle RPC failure, duplicate events, restart recovery, and (EVM only)
reorgs — spec section 27. Uses checkpoints stored per-chain so a restart
resumes rather than re-scans from genesis.
