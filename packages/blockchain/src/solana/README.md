# packages/blockchain/src/solana — implemented, NOT yet verified on-chain

`SolanaAdapter.ts` now exists and implements `BlockchainAdapter`, wrapping
the same Token-2022 approach already proven in the earlier single-chain
build's `contracts/solana` scripts. Read this file's status carefully —
"implemented" and "verified" are different claims here on purpose.

## What actually exists now

- `SolanaAdapter.ts` — real implementation: `buildCreateTokenTransaction`
  (mint + 3% TransferFeeConfig + init mint), `buildMintSupplyTransaction`,
  `buildRenounceMintAuthorityTransaction`, `submitTransaction`,
  `getTransactionStatus`, `readTransferFeeConfig` (reads the fee config
  back from chain — the verification method for confirming what's
  actually enforced on-chain), plus the read-side methods
  (`getTokenIdentity`, `getTokenSupplyInfo`, `getTopHolders`,
  `getTransparencyReport`).
- The class takes an RPC URL as config — it does not assume or default to
  any particular cluster. Which network this eventually points at is a
  pending decision, tracked in `docs/ROADMAP.md`, not something baked into
  this file.

## What has NOT been verified, and exactly why

This was written in a sandboxed environment with **no internet access**
— confirmed directly (`curl` to Solana RPC endpoints returns a
blocked-host error from the sandbox's own network policy, not from
Solana). That means:

- `@solana/web3.js` and `@solana/spl-token` could not be `npm install`ed,
  so this file has **never been type-checked** against their real type
  definitions. It was confirmed **syntactically valid** by loading it
  through `tsx`'s esbuild-based transform — the only error produced was
  "Cannot find module '@solana/web3.js'", i.e. a missing-package error,
  not a syntax error. That is meaningfully weaker evidence than the full
  `tsc --strict` pass every dependency-free package in this repo got.
- No method that touches the network (all of them, functionally) has
  ever actually run. Zero RPC calls made. Zero transactions submitted, on
  any network.
- Therefore: no real transaction signature exists yet for this stage, on
  devnet, another testnet, or mainnet. See `docs/ROADMAP.md`'s Stage 6
  section for the exact, current status.

## The bar for calling this "done" hasn't moved

A real transaction, on whichever network is actually approved for
testing, submitted and confirmed, with the signature checked against a
block explorer, and the transfer-fee config read back from the chain and
confirmed to match the 100%-to-creator model (`withdrawWithheldAuthority`
equals the creator's own address). Code existing and looking right is
necessary, not sufficient — and this file does not get to pick its own
test network either.
