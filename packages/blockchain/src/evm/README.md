# packages/blockchain/src/evm — Stage 7, not started

Empty on purpose, same reason as the `solana/` sibling directory: this
file exists so the directory survives zip/export, and so Stage 7 starts
from a written spec instead of a blank page.

## What goes here

An `EvmAdapter` class implementing `BlockchainAdapter`, for Base and BNB
Chain. Per ADR-0003 (`docs/ARCHITECTURE.md`), this adapter launches with
**trading and discovery only — no transaction tax**. A tax-on-transfer
mechanism on an EVM chain means a custom ERC-20 contract, since the
standard doesn't have Token-2022-style built-in fee extensions; writing
one without an audit would reintroduce exactly the risk pattern this
project avoided on Solana. That contract, and the audit it needs, are
tracked separately as Stage 22 — not part of this adapter's first
version.
