# packages/blockchain/src/solana

The Solana adapter supports classic SPL Token reads and launch transaction
construction. New SIGNAL launches do **not** use Token-2022 transfer-fee
extensions.

## Current fee model

- SIGNAL launch fee: **0.001 SOL**, paid to the SIGNAL platform wallet.
- Creator trading fee: **1% of the SOL side** of SIGNAL-routed trades, paid
  in native SOL to the token creator.
- Holder rewards: none.
- Ordinary wallet-to-wallet token transfers do not create a SIGNAL creator
  fee.
- External DEX trades that bypass SIGNAL's router/settlement are not claimed
  to pay the SIGNAL creator fee.

The browser launch path and `SolanaAdapter.ts` both create classic SPL Token
mints. The legacy withheld-token collection hook is disabled.

## Verification status

The SELL settlement path has been proven on Solana Devnet with a controlled
Raydium CPMM pool, including native-SOL creator payout, settlement-account
closure, simulation gating, and replay rejection. This is test evidence only;
it does not enable production or Mainnet execution.

Wallet execution remains fail-closed behind simulation and transaction-message
integrity checks. Trading UI is still disabled while Stage 3 verification
continues.

No private key or seed phrase belongs in this repository. Transactions are
unsigned until the user's wallet signs them.
