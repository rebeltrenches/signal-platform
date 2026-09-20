# Architecture — Stage 1

Status: **Stage 1 (architecture + repo foundation) — complete.** No app runs
yet. This document is the map; the roadmap in `ROADMAP.md` is the schedule.

## What "done" means at each stage

A big source of confusion on projects like this is treating "the code
exists" as "the product works." To be explicit: at the end of Stage 1,
you have a real, type-checked, tested repository skeleton — not a running
website, not a live database, not anything deployed. That's expected and
correct for Stage 1. It becomes a running thing across Stages 2–13, and it
becomes a *safe* thing to put real money behind only after Stage 19
(security hardening) and a professional audit — see `SECURITY.md`.

## Decisions confirmed for this build (updated 2026-09-19 — see ADR-0011)

- **Signal Fee: 1% total on applicable Solana token transfers, 100% to
  the Signal platform wallet** (`SIGNAL_PLATFORM_WALLET`,
  `packages/config/src/platform-wallet.ts`). The token's creator
  receives 0% of this fee. No holder-rewards pool. This supersedes the
  100%-to-creator model below (ADR-0010), which itself superseded an
  earlier platform/holder model — see ADR-0011 for the full reasoning.
  Encoded in `packages/types/src/index.ts` as `DEFAULT_TAX_CONFIG`
  (`{enabled, totalBps}`, now `totalBps: 100`) and tested in
  `packages/utils/tests/tax.test.ts`.
- **Launch Fee: a separate, one-time 1% fee** (`LAUNCH_FEE_BPS`,
  `packages/types`), calculated from the creator's actual real launch
  payment when one exists — not from supply or an assumed market
  value. No base launch payment has ever been defined in this product,
  so this fee is not currently charged anywhere; the formula
  (`computeLaunchFeeFromPayment`, `packages/utils/src/tax.ts`) is real
  and tested, ready for when one is defined as an actual product
  decision. See ADR-0011.
- **Terminology (2026-09-19):** the product now says "Signal Fee" (for
  the transfer fee) and "Launch Fee" (for the creation-time fee)
  everywhere a person would read it, replacing "Transfer Fee"/"Creator
  Fee." As with the 2026-09-17 terminology decision below, this is
  display-only in spirit, but this round DID rename the corresponding
  internal identifier where it directly named the old, now-incorrect
  recipient: `creatorTax` is now `platformTax`
  (`packages/utils/src/tax.ts`) — leaving a field named `creatorTax`
  holding the platform's revenue would misrepresent the architecture
  worse than renaming it. Other identifiers (`TaxConfig`,
  `computeTaxSplit`, the `/api/v1/tax/preview` route) are unchanged.
- **Terminology (2026-09-17, historical):** the product said "Transfer
  Fee" everywhere a person would read it instead of "Tax." This is
  display-only: internal code identifiers (`TaxConfig`,
  `computeTaxSplit`, the `TransactionTaxConfiguration` model, the
  `/api/v1/tax/preview` route, `.env` variable names) were left
  unchanged on purpose at the time — renaming those was judged an
  architecture change, not a terminology one. (`creatorTax` was one
  such identifier; it no longer exists — see the 2026-09-19 entry
  above for why that one specifically was renamed this round.)
- ~~ADR-0010 (2026-09-17) — FINAL: confirmed 100%-to-creator, no
  platform/holder split, after the fee model changed four times in one
  day.~~ **Superseded by ADR-0011 (2026-09-19).** Full sequence, for the record: (1) 2% platform / 1% holder →
  (2) 100% creator → (3) 2% platform / 1% holder again → (4) 100%
  creator again, then explicitly stated as final. Concretely, state (3)'s
  additions were removed once more: `packages/types`' `TaxConfig` lost
  `platformBps`/`holderRewardBps` again; `packages/utils/src/tax.ts`
  lost `platformTax`/`holderRewardTax`/`splitCollectedFee()` again;
  `packages/config/src/platform.ts` (`SIGNAL_PLATFORM_WALLET_ADDRESS`)
  was deleted again; `packages/database/prisma/schema.prisma` lost the
  `HolderReward`/`HolderRewardClaim` models and their smoke test again;
  `SolanaAdapter.ts` returned to the single-authority model
  (`mintAuthority` = `transferFeeConfigAuthority` = `withdrawWithheldAuthority`,
  all the launcher's wallet); `SolanaFeeOperations.ts` and
  `apps/worker/src/harvest-and-distribute.ts` were deleted again.
  `apps/web/src/client/launch-solana.js` was reverted to set the
  launcher as both fee authorities (matching `SolanaAdapter.ts` exactly)
  — the separate-fee-authority placeholder/guard logic from state (3) is
  gone entirely, so there is no code path left that could route a fee
  anywhere but the connecting wallet. **Zero real transactions have ever
  been executed under any version of this fee model, on any network.**
  See `docs/ROADMAP.md`'s Stage 6 for the complete history, kept in full
  for anyone who needs to understand how this happened.
- **ADR-0011 (2026-09-19) — a fifth reversal: 1% Signal Fee + 1% Launch
  Fee, 100% to a real Signal platform wallet, explicitly instructed
  this time rather than arrived at through back-and-forth.** Unlike
  ADR-0004 through ADR-0010's same-day flip-flopping, this change came
  as an explicit, direct instruction with a real wallet address
  (`FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19`) two days later, not
  another reversal-of-a-reversal. Concretely: `SolanaAdapter.ts`'s
  `transferFeeConfigAuthority`/`withdrawWithheldAuthority` now route to
  `getPlatformWalletAddress()` (`packages/config`) instead of the
  launcher; `launch-solana.js` mirrors this via a build-time-injected
  `window.SIGNAL_PLATFORM_WALLET` (never hardcoded in client source);
  `collect-fees.js`/`dashboard.js`'s collection-authorization gate was
  fixed to check the platform wallet instead of the token's creator — a
  real bug that would have silently confused creators (an unreachable
  "Collect Fees" button that could never actually succeed) had it not
  been caught during this change. An initial attempt to derive the
  Launch Fee from the mint's rent-exemption cost was corrected after
  clarification that rent is a normal network fee, not a real launch
  payment — no base launch payment has ever been defined in this
  product, and none was invented to have something to apply 1% to.
  **Zero real transactions have ever been executed under any version of
  this fee model, on any network** — same as every ADR before this one.
- **ADR-0012 (2026-09-20) — real Watchlist/Alert configuration, then a
  run of four small stages wiring existing backend capability to UI
  surfaces that had never used it.** Five real, tested commits, in
  order:
  1. Watchlist (real, database-backed, session-authenticated CRUD,
     with the existing localStorage cache preserved as an offline-first
     layer and synced rather than replaced) and Alert configuration
     (create/list/delete settings only — deliberately no threshold
     checking, scheduler, or notification delivery, none of which
     exist).
  2. Token search (`GET /api/v1/search`, simple substring matching)
     and Explore's "New" tab wired to real registered-token data —
     the roadmap's own Stage 12 stub, resolved using only Stage 2's
     existing registration, no new infrastructure.
  3. Dashboard's "Your launches" wired to the existing, already-tested
     `GET /api/v1/tokens/mine` for real cross-device sync — zero new
     backend code, since that endpoint has existed since Stage 2.
  4. The same "is this actually registered on Signal" check
     (`GET /api/v1/tokens/:chain/:address`) applied to Watchlist
     entries and to two specific fields on WalletDetailPage (Created
     tokens, Passport's launch count) — each a narrow, honest fix, not
     a redesign of either page.
  Common thread across all four: no new backend routes or repository
  methods were needed for any of them except Watchlist/Alert's own —
  the capability already existed and had already been tested; only the
  UI wiring was missing. Each was verified with a real, executed
  Playwright test, not just a unit test, including one genuine
  regression found and fixed correctly during this run (chat-e2e.test.py
  failing 18/19 after TokenDetailPage's own real lookup started
  producing a real, honest 404 in a test context that had never
  registered the address it checks — fixed by registering it for real
  in that test's own setup, not by weakening what the test checks for).
  After this run, the pattern was checked exhaustively across every
  page and found genuinely exhausted — what remains in the API stub
  list (`/api/v1/launches`, `/trades`, `/holders`, `/wallets`,
  `/creators`, `/analytics`, `/rewards`) is either blocked on real
  infrastructure this sandbox has never had (a live RPC endpoint, a
  real DEX SDK, a persistent worker) or would mean deciding to build a
  genuinely new feature area, which this ADR does not do.
- ~~ADR-0009 (2026-09-17) — reverted ADR-0006/0007 back to the
  platform/holder model.~~ **Superseded by ADR-0010.** This was state
  (3) above — kept for history only.
- ~~ADR-0006 (2026-09-17) — reversed ADR-0004/0005 the same day.~~
  **Superseded by ADR-0010** (this was state (2), the model ADR-0010
  ultimately returned to).
- ~~ADR-0007 (2026-09-17) — ADR-0006 implementation details.~~ Superseded
  along with it — see ADR-0008 immediately below for what ADR-0007
  actually still applies to (Phase 4's Mainnet-capable transaction flow,
  which remains real and independent of which fee model it targets).
- ~~ADR-0004 (2026-09-17) — the 2% platform fee goes to a fixed Signal
  platform wallet, not each launcher.~~ **Superseded by ADR-0010.** This
  was state (1). Kept for history: this decision set the destination to
  `FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19`, stated as a public
  address.
- ~~ADR-0005 (2026-09-17) — ADR-0004 implemented, not yet executed.~~
  **Superseded by ADR-0010.** Kept for history only.
- **ADR-0008 (2026-09-17) — Phase 5: premium light redesign.** Light is
  now the default theme (previously dark-only) — white/off-white
  backgrounds, dark navy/black typography, Signal purple/blue accents
  reserved for links/highlights, black/dark CTA buttons (a deliberate
  premium-fintech pattern, not a generic bright-button default), subtle
  shadows, and hover transitions throughout. The original dark palette is
  preserved as an explicit opt-in (`data-theme="dark"`) rather than
  deleted. Verified across all 9 pages, desktop and mobile, via
  screenshot — caught one Playwright full-page-screenshot artifact
  (sticky header appearing to overlap content; confirmed via a normal
  viewport screenshot that this doesn't happen in real use) and one
  genuinely stale content bug (`HomePage.tsx` still said "2%/1% tax
  split" from before a fee-model reversal — fixed, rebuilt, reverified).
- **ADR-0007 (2026-09-17) — Phase 4 (real Mainnet-capable transaction
  flow), Phase 6 (evidence-sourced facts, Transparency Center), Phase 7
  (real client-side portfolio/watchlist), and Phase 8–10 architecture
  (Community, Wallet Intelligence, Robinhood Chain).** In order of what's
  actually real vs. architecture-only:
  - **Real, verified, never executed:** `apps/web/src/client/launch-solana.js`
    — a genuine Mainnet-capable create-token flow (connect Phantom, build
    the real Token-2022 transaction, sign, submit, confirm), mirroring
    `SolanaAdapter.ts` exactly. No devnet option anywhere in it. Verified
    by stubbing only the CDN imports this sandbox's network policy blocks
    (same restriction that's applied throughout this build) — real
    orchestration logic confirmed correct (authorities, bps, supply math,
    sequencing), never actually run against mainnet.
  - **Real, working today:** `apps/web/src/client/watchlist.js` (real
    localStorage add/remove, verified to survive an actual page reload)
    and `apps/web/src/client/portfolio.js` (real live on-chain balance
    reads for the connected wallet — genuine data when run with real
    internet, verified the same stubbed way as the launch flow).
    `launch-solana.js` now also records a real launch to the same
    dashboard, only after both transactions actually confirm.
  - **New type system:** `EvidenceSource` (`packages/types`) — every fact
    Signal shows now carries where it came from
    (blockchain-derived/signal-verified/creator-provided/third-party/
    community-reported), rendered via the new `SourcedRow` component.
    Used throughout `TokenDetailPage`'s new "Signal Check" tab and
    `WalletDetailPage`'s new "Signal Passport" tab — real tab-switching,
    every fact honestly "Unavailable" until Stage 11 exists.
  - **New pages:** `/transparency` (Transparency Center, section 13) and
    `/community` (honestly Coming Soon, section 16/8 — real chat needs a
    running server and Stage 19 auth, neither of which can exist in this
    sandbox).
  - **Schema additions, architecture only:** `ChatRoom`/`ChatMessage`/
    `MessageReport`/`UserReport` (Community) and `WalletRelationship`/
    `WalletNote` (Wallet Intelligence) — no row in any of these has ever
    been written by real activity. `WalletRelationship`'s `relationshipType`
    is deliberately observational ("funded", not "same owner as") per
    spec section 14's explicit rule against claiming shared identity
    without evidence.
  - **Robinhood Chain** added to `CHAIN_CONFIGS` as planned, with a new
    `discoverySupported` field on `ChainConfig` deliberately separate
    from `adapterImplemented` — section 22 explicitly wants discovery and
    deployment treated as independent capabilities. Both false for every
    chain today, including Solana — discovery needs Stage 11 regardless
    of chain.
  - **A real bug caught by screenshot review, twice this session:**
    `moduleScripts` existed in the route config but was never actually
    passed to `Shell` (fixed); a `\u2192` written directly as JSX text
    rendered as literal characters instead of an arrow, since JS escape
    sequences only resolve inside real string literals, not raw JSX
    children (fixed, swept for recurrences).
- **ADR-0003 — EVM chains launch without a transfer-fee mechanism.**
  Solana's Signal Fee comes from Token-2022's `TransferFeeConfig`
  extension: an existing, audited, Solana-Labs-maintained feature — no custom contract needed, no
  new attack surface. Base and BNB Chain have no equivalent built into the
  ERC-20 standard; achieving the same tax there means *writing* a custom
  token contract, which is exactly the historically exploit-prone pattern
  ("tax token" rug-pull mechanics) that Token-2022 let us avoid on Solana.
  Decision: **EVM chains launch with trading + discovery only, no tax,
  until a custom contract exists and has been through a real audit.**
  `packages/config/src/chains.ts` encodes this as `taxSupported: false`
  for `base` and `bnb`.

## Repository layout

```
apps/
  web/        Next.js frontend — Stage 4
  api/        Backend API (versioned REST) — Stage 3
  indexer/    Background chain indexers — Stage 11
  worker/     Queue-based background jobs (reward distribution, alerts) — Stage 11/15

packages/
  types/      Shared TypeScript types — the contract every other package agrees to. DONE.
  utils/      Chain-agnostic pure logic (tax math, money helpers). Tax module DONE + tested.
  config/     Per-chain configuration registry. DONE.
  database/   Prisma schema + migrations. Schema DONE (not yet migrated — needs a real Postgres).
  blockchain/ BlockchainAdapter interface (core) + solana/evm implementations (Stage 6/7).
  dex/        DexAdapter interface + route comparison. Interface DONE; adapters Stage 10.
  ui/         Shared React components — Stage 4.
  analytics/  Platform/token analytics queries — Stage 17-ish.
  security/   Shared auth/validation middleware — Stage 19.

contracts/
  solana/     Anchor + Token-2022 program(s) — Stage 6. Starting point: the
              standalone Token-2022 transfer-fee scripts from the earlier
              single-chain build (1-create-token.ts etc.) — same mechanism,
              now wrapped behind BlockchainAdapter instead of run by hand.
  evm/        Deliberately empty for now — see ADR-0003.

docs/         This folder.
tests/        Cross-package integration tests (added as apps come online).
docker/       Local dev infra (Postgres, Redis).
```

## Why these technology choices

| Area | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + (later) Turborepo | Standard for a multi-app, multi-package TS repo; incremental builds matter once `apps/indexer` exists alongside `apps/web`. |
| Language | TypeScript, strict mode | Financial code benefits enormously from a type checker catching a `number` where a `bigint` was meant — see `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` in `tsconfig.base.json`. |
| Database | PostgreSQL + Prisma | Relational integrity matters for holder balances, trade history, and audit logs; `Decimal`/`BigInt` columns instead of float, per spec section 24/46. |
| Solana transfer-fee mechanism | Token-2022 `TransferFeeConfig` | Audited, built into the base program — see ADR above. |
| EVM (Stage 7+) | Solidity + OpenZeppelin | Spec section 29 — battle-tested primitives rather than hand-rolled token logic. |
| Cache/queue | Redis | Backing store for rate limiting, real-time fan-out, and background job queues (Stage 11). |

## Blockchain & DEX abstraction

`BlockchainAdapter` (`packages/blockchain/src/core`) and `DexAdapter`
(`packages/dex/src/DexAdapter.ts`) are the two interfaces that keep
`apps/api` and `apps/web` chain-agnostic. A new chain (Ethereum, Sui, TON,
...) means: implement these two interfaces, add a `ChainConfig` entry,
write a migration if the chain needs new fields. It should **not** mean
touching route handlers, React components, or the database schema's shape.

Every transaction-building method returns an **unsigned** transaction —
signing happens only in the user's own wallet. No adapter method ever
takes a private key. See `SECURITY.md`.

## Data-integrity rules encoded directly in the types

Spec section 41 ("no fake functionality") and section 3/10 ("never
fabricate a metric") aren't just prose here — they're the `DataPoint<T>`
type in `packages/types`. Anywhere the frontend would show a number that
came from an indexer or an external API, the type is
`DataPoint<T> = { status: 'available', value: T, asOf } | { status: 'unavailable' }`,
not `T | null`. That forces every consuming component to handle "we
genuinely don't have this yet" as a distinct rendering case from "the
value is zero" — you cannot accidentally render `0` for a holder count
you failed to fetch.

## Rounding policy (Signal Fee math)

All fee math is integer basis-points arithmetic on `bigint`, never
floats (`packages/utils/src/tax.ts`). There's no split to round between
(ADR-0011, current state) — `platformTax` equals `totalTax` exactly, and
`platformTax + netAmount` is asserted to equal `grossAmount` for every
input, verified for edge-case amounts in the test suite (including 1, 3,
7, and very large values). No rounding remainder ever needs a "which
side does the dust go to" policy — there's only one side.

## What Stage 1 does NOT include (by design)

- No running frontend, API server, or indexer.
- No deployed contracts, on any network, including devnet.
- No live database — `docker-compose.yml` defines local Postgres/Redis,
  but nobody has run `docker compose up` yet in this sandbox (no internet
  here to pull the images — see `KNOWN_LIMITATIONS` in the Stage 1 status
  report).
- No Solana/EVM adapter implementations — `packages/blockchain/src/solana`
  and `.../evm` are Stage 6/7.
- No bonding curve math — Stage 8, deliberately not rushed into Stage 1.

## Full documentation index

This build consolidates several of the doc files the original spec listed
separately (`API.md`, `BLOCKCHAIN.md`, `DATABASE.md`) into this one
document's sections, plus the schema file and adapter interfaces
themselves, which are more precise than a prose description would be.
`SECURITY.md` and `ROADMAP.md` remain separate since they're read by
different audiences (an auditor; you, tracking progress) at different times.
Split any section back out into its own file whenever it grows large
enough to want that.
