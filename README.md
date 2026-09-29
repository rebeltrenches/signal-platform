# SIGNAL

SIGNAL is a multi-chain token discovery, launch, trading, transparency, community, and wallet-intelligence platform. Solana is the first launch/trading chain; Base and BNB support are being added in stages.

## Current Solana launch model

The bonding-curve branch replaces the legacy launch flow that sent the full token supply to the creator wallet.

For a new SIGNAL Solana launch:

- the creator chooses the token metadata, supply, and decimals;
- minimum supply is 100,000,000 tokens;
- the complete supply is minted into a program-controlled bonding-curve vault, not the creator wallet;
- the creator receives 0 tokens automatically and may acquire tokens only by buying from the curve like any other participant;
- mint authority is revoked and no freeze authority is configured;
- 79.31% of supply is available through the bonding curve;
- 20.69% is reserved for post-curve liquidity;
- buys and sells use a constant-product virtual-reserve curve;
- eligible curve trades charge a 1% SIGNAL fee in SOL to the configured platform wallet;
- when the curve finishes, trading on the curve closes and the reserved tokens plus curve SOL migrate to a Raydium CPMM pool;
- withdrawable LP tokens received by SIGNAL's migration PDA are burned during graduation.

The current one-time Solana launch fee is 0.001 SOL. Normal Solana network/rent and metadata-storage costs are separate.

## Safety model

SIGNAL is non-custodial. The website does not hold a user's private key or seed phrase, and wallet transactions require the user's own wallet approval.

The bonding-curve program independently checks critical rules on-chain rather than trusting only browser validation. Current automated coverage includes:

- minimum and maximum supply boundaries;
- mint/freeze authority checks;
- full-supply curve custody;
- real local-Solana initialize, buy, sell, slippage rejection, and fee-recipient rejection;
- exact final curve fill and post-completion trading lock;
- transaction-size checks for atomic final-fill graduation;
- Raydium CPMM graduation against a locally cloned copy of the public Mainnet Raydium program and accounts;
- LP-token burn after migration; and
- interrupted/prepared graduation recovery.

See `docs/SECURITY.md` for the current engineering/security model. A professional independent security review and legal review remain required before treating the platform as production-ready for broad real-money use.

## Repository

This is a pnpm monorepo. Important areas include:

- `apps/web` — SIGNAL web interface and browser transaction flows
- `apps/api` — API services
- `packages/*` — shared types, config, blockchain, DEX, database, and utilities
- `programs/signal-bonding-curve` — Solana bonding-curve and Raydium-graduation program
- `config/restrictions.json` — regional availability/notice configuration
- `docs/SECURITY.md` — current security and transaction model

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @launchpad/web build
cargo test --manifest-path programs/signal-bonding-curve/Cargo.toml
cargo check --manifest-path programs/signal-bonding-curve/Cargo.toml
```

The GitHub workflows on the bonding-curve branch also build the deployable Solana SBF artifact and run local-validator integration tests.

## Deployment guard

`SIGNAL_BONDING_CURVE_PROGRAM_ID` must be supplied to a deployable web build. If it is absent, token launching is intentionally disabled. The site does not fall back to the legacy full-supply-to-creator launcher.

Mainnet/production deployment is intentionally separate from branch development and should only happen after the intended program ID, environment, tests, security review, and release approval are confirmed.
