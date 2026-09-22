# contracts/solana — historical reference only

The earlier standalone Token-2022 transfer-fee design is superseded and must
not be used for new SIGNAL launches.

Current Solana model:

- New launches use classic SPL Token.
- SIGNAL receives the fixed 0.001 SOL launch fee.
- The token creator receives 1% of the SOL side of SIGNAL-routed trades in
  native SOL.
- There is no holder-reward split.
- The legacy withheld-token harvest/withdraw path is disabled.

Active launch logic lives in `packages/blockchain/src/solana` and
`apps/web/src/client/launch-solana.js`. Active BUY/SELL settlement logic
lives in `packages/dex` and `programs/signal-sell-settlement`.

This directory is retained only to document the project's earlier starting
point; it is not the current fee implementation.
