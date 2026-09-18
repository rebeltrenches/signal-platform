# Multi-Chain Launchpad — Stage 1

A multi-chain token launchpad and trading terminal (Solana, Base, BNB
Chain, with room to add more). This is **Stage 1**: architecture and repo
foundation. Nothing here runs as a live product yet — see
`docs/ROADMAP.md` for what that actually takes and in what order.

## What's real right now

- Type-checked, tested shared logic (`packages/types`, `packages/utils`)
- A complete database schema (`packages/database/prisma/schema.prisma`)
- The two abstraction interfaces the whole multi-chain design rests on
  (`packages/blockchain`, `packages/dex`)
- Full architecture, security baseline, and roadmap docs (`docs/`)

## What's not real yet

No frontend, no API server, no indexer, no deployed contracts, no live
database. Those are Stages 2–21 — see `docs/ROADMAP.md`.

## Running what exists today

```bash
# Install dependencies (needs internet — wasn't possible in the sandbox
# this was built in, so this hasn't actually been run against this repo yet)
pnpm install

# Run the real, passing test suite for the tax module
npx tsx packages/utils/tests/tax.test.ts

# Type-check everything
npx tsc --noEmit -p tsconfig.json

# Once you have Docker: local Postgres + Redis for Stage 2
docker compose -f docker/docker-compose.yml up -d
```

## Read next

1. `docs/ARCHITECTURE.md` — the full picture, including the two decisions
   confirmed for this build (tax split, EVM tax deferral)
2. `docs/SECURITY.md` — what's already enforced, what's deliberately not
   built yet, and the audit/legal gate before mainnet
3. `docs/ROADMAP.md` — stage-by-stage plan and the Stage 1 completion report
