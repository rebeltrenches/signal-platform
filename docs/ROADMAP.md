# Roadmap

Stages match the original spec's section 44, with two adjustments: Base
and BNB tax work is deferred out of Stage 7 into a future "Stage 22 —
audited EVM tax" once a contract exists and is audited (ADR-0003), and
Stage 21 (devnet/testnet deployment) was originally planned to happen
before any mainnet stage, which the first spec implied but didn't number
separately.

**Resolved (2026-09-17):** devnet will not be used, at any point. Stage
21 as originally scoped ("devnet/testnet deployment" before mainnet) is
superseded by this — it will not happen as originally written. How
verification happens before real mainnet use, without a devnet step, is
still an open question (see Stage 6's Decision 1 below) — but the
devnet-vs-mainnet conflict itself is settled: mainnet is the only target,
eventually, and not yet in the sense of implementation being approved.

Each stage below only starts once the previous one is coherent and
tested — per the spec's own rule (section 44/45), not skipped here.

| Stage | What | Status |
|---|---|---|
| 1 | Architecture, repo skeleton, shared types, tax math + tests, DB schema | **DONE** |
| 2 | Database — real migrations against a live Postgres | **PARTIAL** — see below |
| 3 | Backend API skeleton (versioned routes, no business logic yet) | **DONE** for skeleton scope |
| 4 | Frontend skeleton — real pages, no framework installable offline (see below) | **DONE** for skeleton scope |
| 5 | Wallet infrastructure (connect flows for Phantom + EVM wallets) | NEXT |
| 6 | Solana token creation — wire the existing Token-2022 fee logic into `BlockchainAdapter` for real, confirmed on-chain transactions (see acceptance criteria below) | Not started |
| 7 | EVM token creation — Base + BNB, **trading/discovery only, no tax** (ADR-0003) | Not started |
| 8 | Bonding curve | Not started |
| 9 | Trading | Not started |
| 10 | DEX integration (Raydium/Orca; Uniswap-compatible/PancakeSwap) | Not started |
| 11 | Indexer + background workers | Not started |
| 12 | Launch Radar | Not started |
| 13 | Transparency engine ("Proof Before You Buy") | Not started |
| 14 | Whale tracking | Not started |
| 15 | Watchlists + alerts | Not started |
| 16 | Creator system | Not started |
| 17 | AI factual analysis | Not started |
| 18 | Admin | Not started |
| 19 | Security hardening (auth, rate limiting, input validation) | Not started |
| 20 | Testing (integration, e2e) | Not started |
| 21 | ~~Devnet/testnet deployment~~ — superseded, devnet excluded (2026-09-17) | Won't happen as scoped |
| — | **Professional audit + legal review** (gate before any mainnet stage) | Not started |
| 22 | Audited EVM tax contract (unblocks tax on Base/BNB) | Deferred, not scheduled |

## Stage 6 — acceptance criteria (defined 2026-09-17; decisions resolved AND implemented 2026-09-17; execution not yet approved)

**READ THIS FIRST — the fee model changed four times total on 2026-09-17,
then a fifth time on 2026-09-19 (Decision 4 below / ADR-0011 in
docs/ARCHITECTURE.md). Current, confirmed state, as of the latest change:**
- 1% Signal Fee on applicable token transfers, 100% to the Signal
  platform wallet (`SIGNAL_PLATFORM_WALLET`) — the creator receives 0%
- A separate, one-time 1% Launch Fee, real and tested but not
  currently charged (no base launch payment has ever been defined)
- **NO** holder-rewards allocation
- `SolanaAdapter.ts`'s `transferFeeConfigAuthority`/
  `withdrawWithheldAuthority` are the Signal platform wallet;
  `mintAuthority` remains the launcher's own wallet
- `apps/web/src/client/launch-solana.js` mirrors this via a
  build-time-injected `window.SIGNAL_PLATFORM_WALLET`, never hardcoded

The four-reversal-in-one-day history below (Decisions 2 and 3,
2026-09-17) describes what was true THEN — preserved as history, not
edited, since it genuinely happened and understanding it matters. It is
**not** the current state; see Decision 4 below for that.
- Sections below this note that describe a 2%/1% platform+holder split
  are from an intermediate state and are superseded by the above — kept
  as history, not current status. Full four-state sequence: (1) 2%
  platform / 1% holder → (2) 100% creator → (3) 2% platform / 1% holder
  again → (4) 100% creator again, final.

**Both pending decisions were resolved this session (2026-09-17), and the
code implementing them was written the same day. Implementation
(writing the code) is done. Execution (running any of it against a real
network) is a separate thing that has NOT happened and is NOT approved —
see the honesty notes throughout this section and in the code itself.**

### Decision 1 — Network target: RESOLVED

- Devnet will **not** be used, at any point, including for testing. This
  is an explicit reversal of this file's earlier assumption that Stage 6
  would be verified on devnet first.
- The eventual deployment target is **Solana Mainnet**.
- **Execution is still on hold.** No live network-targeting
  transaction code (RPC connections, transaction building aimed at a real
  cluster, signing flows) is to be written until a separate, explicit
  approval for "the next implementation step." Recording the decision is
  not that approval.
- Open question this decision creates, not yet answered: since devnet is
  excluded and mainnet work is still on hold, there is currently no
  approved way to test a transaction before real mainnet use. How initial
  verification happens (e.g. a deliberate, minimal-amount mainnet test)
  is undecided and shouldn't be assumed either way.

### Decision 2 — Fee destination: SUPERSEDED SAME DAY by Decision 3

Kept for history only. Decision 2 set the 2% platform share to a fixed
Signal wallet (`FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19`) and built
`SolanaFeeOperations.ts` to implement it. That was reversed later the
same day (2026-09-17) by an explicit instruction rejecting any Signal
platform fee or holder-rewards pool — see Decision 3 immediately below.
`SolanaFeeOperations.ts`, the platform-wallet config, and the
`apps/worker` script that used them were **deleted**, not deprecated,
once the reversal was confirmed. Nothing from Decision 2 remains active
in the codebase.

### Decision 3 — 100% to creator: RESOLVED and IMPLEMENTED (2026-09-17, same day as Decision 2's reversal)

**Final model:** 3% total transfer fee, 100% to the token's own creator.
No Signal platform fee. No holder-rewards pool. No automatic holder
distribution. Future holder/community rewards may come later through
separate airdrops — a different mechanism, not part of this fee, not
implemented yet. Confirmed explicitly, more than once, including a
direct confirmation that this fully replaces the platform/holder-reward
model rather than coexisting with it.

**What changed in code, concretely:**
- `packages/types/src/index.ts` — `TaxConfig` is now just
  `{ enabled, totalBps }`. No `platformBps`/`holderRewardBps` fields —
  there's nothing to split, so the type doesn't pretend there is.
- `packages/utils/src/tax.ts` — `computeTaxSplit` returns `creatorTax`
  equal to `totalTax` (100%). `splitCollectedFee()` and
  `CollectedFeeSplit` were **removed** — nothing left to split an
  already-collected amount into.
- `packages/database/prisma/schema.prisma` — `HolderReward` and
  `HolderRewardClaim` models **removed** (with an explanatory comment
  left in their place, not a silent deletion). `TransactionTaxConfiguration`
  simplified to match the new `TaxConfig` shape.
  `packages/database/tests/schema-smoke.test.ts`, which tested the
  double-claim invariant on those now-gone models, was **removed** too
  (a README in its place explains why).
- `packages/blockchain/src/solana/SolanaAdapter.ts` — back to a
  single-authority model: `mintAuthority` = `transferFeeConfigAuthority`
  = `withdrawWithheldAuthority`, all the launcher's own wallet. Gained a
  genuinely new method, `buildHarvestAndWithdrawTransactions` — lets the
  creator harvest and withdraw their OWN accumulated fee via their OWN
  wallet, with zero Signal involvement (this didn't exist even before
  Decision 2 — the original design never needed a harvest step because
  the earlier single-chain build's standalone scripts handled it as a
  separate CLI tool; this is the first time that capability lives inside
  the adapter itself, returning an unsigned transaction like everything
  else in the class).
- `packages/blockchain/src/solana/SolanaFeeOperations.ts`,
  `packages/config/src/platform.ts`, and
  `apps/worker/src/harvest-and-distribute.ts` — **deleted**. Package
  dependencies that existed only to support them
  (`@launchpad/config`/`@launchpad/utils` in `packages/blockchain`)
  removed too.
- `apps/web` — `CreatePage.tsx`, `wizard.js`, `HomePage.tsx`,
  `SecurityPage.tsx` all updated to show the fee as 100% creator, with
  "Signal platform fee: None" and "Holder rewards: None (future
  airdrops, separate)" shown as explicitly distinct, named concepts —
  not just a changed number.
- `.env.example`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md` (new
  ADR-0006) updated to match.

**Still true, unchanged from Decision 1:** Solana Mainnet is the eventual
target; devnet is permanently excluded; no live network-targeting code
has been executed, and none is approved to run yet regardless of how
complete the surrounding implementation looks.

Concretely, Stage 6 is done when, and only when:

1. ~~`SolanaAdapter.ts` implements the confirmed fee model~~ **DONE** —
   single-authority, 100% creator, matching `contracts/solana/1-create-token.ts`'s
   original approach almost exactly (that script never had a Signal
   authority to begin with). **Not yet executed against any real network.**
2. `apps/web`'s Create flow calls this adapter and gets a real wallet
   (Phantom) to sign and submit — replacing the current permanently-disabled
   Launch button. **Not done** — still fully inert by design, pending a
   separate execution approval.
3. **A real transaction has actually been submitted, on whichever network
   is explicitly approved for testing, and confirmed**, with the
   transaction signature recorded and checkable on a block explorer.
   Until then, the accurate status is "wired, not yet confirmed" — not
   "done," not "live."
4. The 100%-to-creator fee is verified from the *actual on-chain*
   transfer-fee config after the mint is created (`readTransferFeeConfig`
   already exists for this), confirming `withdrawWithheldAuthority`
   equals the creator's own address — not merely asserted by the code
   that set it.

**Current state, accurately, across all sessions to date:** Stage 6 code
for Decision 3 is written and internally consistent. **No transaction has
ever been signed, submitted, or confirmed, on any network, in any
session, under any version of this fee model (Decision 2's or Decision
3's).** Item 2 above remains deliberately undone. Two unrelated things
were also done without waiting for Step 6 execution approval, since
neither touches blockchain code: leftover UI/script inconsistencies from
an earlier paused state were fixed (see "Pre-Step-6 fixes" below), and
the Signal logo asset was integrated (header, favicon, hero).

### Pre-Step-6 fixes (2026-09-17)

Found and fixed, per instruction to finish and verify before Step 6 work
resumes:

- `apps/web/src/pages/CreatePage.tsx` — the review step referenced Solana
  devnet by name ("submits real transactions to Solana devnet," a devnet
  SOL faucet link) and showed a step-by-step transaction-status display
  with no script behind it at all, plus a Launch button labeled "Connect
  wallet to launch" that nothing would ever have enabled. Replaced with an
  accurate empty-state: no network mentioned, button unconditionally
  disabled, copy stating plainly that the deployment target is undecided
  and nothing is wired.
- `apps/web/src/client/wizard.js` — removed dead code left over from the
  above (toggling two DOM elements that no longer exist, dispatching an
  event nothing needs anymore).
- `apps/web/scripts/build.tsx` — removed a `moduleScripts` reference to
  `/client/launch-solana.js`, a file that was never created.
- `packages/blockchain/src/solana/SolanaAdapter.ts` and its `README.md` —
  reworded comments that said "devnet, never mainnet" (accurate under the
  old plan, contradicted by the newer instruction) to state plainly that
  the network target is a pending decision this file does not assume an
  answer to either way.
- `docs/ROADMAP.md` (this file) — same correction, plus the open-conflict
  note near the top of this file about Stage 21 vs. the newer
  mainnet-only instruction.

Separately, and unrelated to any network decision: the Signal logo asset
was provided and integrated — `apps/web/src/assets/` (full lockup +
generated icon/favicon crops of the same source image, no redesign),
wired into the header, browser favicon, and homepage hero. `Header.tsx`,
`Shell.tsx`, `HomePage.tsx`, and `build.tsx` (asset-copying step) were
touched for this. This required no blockchain code and no network
decision, so it proceeded without waiting for Step 6 approval.

**This session did not write, modify, or re-enable any transaction-
signing, wallet-submission, or network-targeting logic** — the fixes
above are corrections to leftover UI/doc inconsistencies and an
unrelated asset addition, not progress on Stage 6's actual acceptance
criteria.

### Decision 4 — 1% Signal Fee + 1% Launch Fee, 100% to a real Signal platform wallet: RESOLVED and IMPLEMENTED (2026-09-19, two days after Decision 3)

**Final model:** a 1% Signal Fee on applicable Solana token transfers,
100% to the Signal platform wallet
(`FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19`, configured via
`SIGNAL_PLATFORM_WALLET`). The token's creator receives 0% of this fee
— a full reversal of Decision 3 above, not a coexistence with it.
Separately, a one-time 1% Launch Fee, calculated from the creator's
real launch payment when one exists (never supply or an assumed
market value) — not currently charged, since no base launch payment
has ever existed in this product. No holder-rewards pool, unchanged
from Decision 3. Unlike Decisions 2/3's same-day back-and-forth, this
arrived as one explicit, direct instruction with a real wallet address,
not another reversal-of-a-reversal — see ADR-0011 in
docs/ARCHITECTURE.md for the full reasoning and exact code changes.

**A real bug caught during this change, not just a terminology
update:** `collect-fees.js` and `dashboard.js` were still gating fee
collection on "does the connected wallet match the token's *creator*"
— correct under Decision 3, silently wrong under Decision 4, since only
the platform wallet can actually withdraw now. Fixed to check against
the platform wallet instead.

**An initial mistake, corrected before this was reported done:** a
first attempt derived the Launch Fee from the mint's real
rent-exemption cost, treating that as "the launch payment." Corrected
after direct clarification that rent is a normal network fee, kept
separate from the Signal Fee model by design — not a real launch
payment Signal itself defines. No number was invented to replace it;
the formula stands ready, unused, until a real base payment exists.

**Zero real transactions have ever been executed under any version of
this fee model, on any network** — same as every decision before this
one.

### Decision 5 — real Watchlist/Alert configuration, then four small stages wiring existing backend capability to unused UI surfaces (2026-09-20)

Five real, tested, separately-committed stages, in order — see
docs/ARCHITECTURE.md's ADR-0012 for the full detail:

1. Real, database-backed Watchlist (session-authenticated, existing
   localStorage kept as an offline-first cache and synced rather than
   replaced) + Alert configuration (create/list/delete only —
   deliberately no threshold checking, scheduler, or notifications).
2. Token search + Explore's "New" tab wired to real registered-token
   data — resolves the roadmap's own Stage 12 stub using only Stage
   2's existing registration.
3. Dashboard's "Your launches" wired to the existing
   `GET /api/v1/tokens/mine` for real cross-device sync.
4. The same registration-status check applied to Watchlist entries and
   two fields on WalletDetailPage (Created tokens, Passport's launch
   count).

None of the last three needed any new backend code — the capability
already existed and had already been tested from Stage 2 onward; only
the UI wiring was missing. Each was verified with a real, executed
Playwright test. One genuine regression was found and fixed correctly
during this run: `chat-e2e.test.py` failed 18/19 after
TokenDetailPage's real lookup started producing a real, honest 404 in
a test context that had never registered the address it checks — fixed
by registering it for real in that test's own setup, not by weakening
the check.

**After this run, the same pattern was checked exhaustively across
every remaining page and found genuinely exhausted.** What's left in
the API stub list (`launches`, `trades`, `holders`, `wallets`,
`creators`, `analytics`, `rewards`) is either blocked on real
infrastructure this sandbox has never had, or would mean deciding to
build a genuinely new feature area — a decision this entry does not
make.

## Stage 4 completion report — Frontend skeleton

**COMPLETED:**
- `apps/web` — 7 real pages, server-rendered with React (`react-dom/server`):
  Home, Create (4-step wizard), Explore, Token detail (layout template),
  Wallet detail (layout template), Dashboard, Security. Full design system
  in `apps/web/src/styles` (tokens, base, components) — evolved from the
  earlier single-chain build's look rather than restarted, with a
  dedicated brand color (violet) kept deliberately separate from the
  green/red used for real market data.
- Reusable components (`apps/web/src/components`): `Header`, `Footer`,
  `ChainBadge`/`ChainDot`, `DataValue` (renders `DataPoint<T>` honestly —
  see below), `EmptyState`.
- Client-side interactivity (`apps/web/src/client`, plain JS, no framework
  needed): wizard step navigation + validation, real Phantom wallet
  connect, mobile nav drawer, explore tab/filter switching.
- **Verified by actually running it**, not just written: built the static
  site for real, served it locally, and used Playwright to screenshot
  every page at desktop and mobile widths, plus drive the create-wizard
  through real clicks and form fills. This caught two genuine bugs before
  delivery: a React `<title>` warning (array children instead of a
  template string) and an off-by-one in the wizard's tax-display update
  (it was updating when *leaving* the config step instead of *arriving*
  at it, so switching to an EVM chain didn't show the "tax unavailable"
  message until one step too late). Both fixed and re-verified with fresh
  screenshots.
- Confirmed by screenshot: the Solana path shows the real 2%/1% split
  (rendered from `DEFAULT_TAX_CONFIG` via `bpsToDisplay`, not a hard-coded
  string); the Base/BNB path shows an honest "tax isn't available on this
  chain yet" message instead of a wrong number.

**Why no Next.js:** this sandbox has no internet, so nothing beyond what
Node ships built-in, plus the already-globally-installed React/Playwright,
could actually be installed and run. `react-dom/server` gave real,
correct SSR without a bundler; a hand-rolled ~60-line router
(`apps/web/scripts/build.tsx`) stands in for Next's file-based routing for
now. The page components themselves are ordinary React components with no
sandbox-specific workarounds baked in — migrating to real Next.js later is
expected to be closer to a lift-and-shift than a rewrite, but that's a
claim to verify once someone actually does it with real tooling, not
something this sandbox could confirm.

**No fake blockchain transactions — audited specifically for this:**
- Grepped the entire repo for "success", "fake", "simulat", "mock" —
  every real hit is either a comment *stating* the no-fake-data rule, or
  the legitimate `TxState.simulating` value (a real pre-flight-simulation
  phase in Solana's transaction lifecycle, part of the state machine from
  spec section 50 — not a fake success state).
- The Create flow's final "Launch" button is `disabled` in the JSX with no
  `data-action` attribute, so `wizard.js` has zero event listener on it —
  confirmed by reading the client script, not just by the button's visual
  style. Clicking it does nothing at all, by construction.
- Every stat that would come from an indexer or a live chain renders
  through `DataValue`/`EmptyState`, which only ever show "Unavailable" or
  a designed empty state — never a placeholder number that could be
  mistaken for real data.

**Where the platform-fee (2%/1%) logic currently lives, and what it's
connected to** *(historical note: written during the Stage 4 report,
before Stage 6 existed — terminology updated to "platform fee" for
consistency; see Stage 6 above for what has since been implemented)*:
- The *number itself*: `packages/types/src/index.ts` (`DEFAULT_TAX_CONFIG`)
  — one source of truth, imported everywhere it's shown.
- *Validated and split*: `packages/utils/src/tax.ts` (`computeTaxSplit`) —
  pure, tested logic (9 passing tests at the time this was written; 13 now).
- *Exposed over HTTP*: `apps/api/src/routes/tax.ts` — a real, running
  endpoint that computes a real split for a given amount.
- *Shown in the UI*: `apps/web/src/pages/CreatePage.tsx` — reads the same
  constant, renders the real percentages.
- *Actually enforced on-chain*: as of Stage 4, **not yet, in this repo**
  — see Stage 6 above for the current, updated status (implemented,
  not yet executed). At Stage 4's time of writing, the real enforcement
  mechanism was Solana Token-2022's `TransferFeeConfig` extension,
  implemented only in the earlier single-chain build's `contracts/solana`
  scripts (`1-create-token.ts` set the 2%/1% split on the actual mint;
  `2-harvest-and-split.ts` / `3-reward-holders.ts` moved the real funds),
  not yet wired into this repo.

**NOT DONE, as of Stage 4 (see Stage 6 above for what's since changed):**
- No wallet-signed transaction of any kind (Stage 5).
- No connection between this repo's UI and the earlier `contracts/solana`
  scripts (Stage 6).
- No real routing between pages beyond static files — a real deploy needs
  either Next.js (once installable) or a small static-file server config
  for clean URLs.

**KNOWN ERRORS/WARNINGS:**
- `tsc --noEmit` cannot fully pass in this sandbox: `@types/node`,
  `@types/react`, and `@types/react-dom` aren't installed (no internet),
  so Node/React globals and JSX intrinsics report as errors under a
  from-scratch type-check config. All three are already listed in the
  relevant `package.json` files' `devDependencies` for when a real
  `pnpm install` runs. This is a type-checker gap, not a runtime one —
  the actual rendered output and test runs (above) are the real evidence
  of correctness here, and both are clean.
- Two real bugs were found and fixed this session (see above); zero known
  remaining issues in the code as delivered.

## Stage 2/3 completion reports (unchanged from last session)


**COMPLETED:**
- `packages/database/tests/schema-smoke.test.ts` — a real, running proof
  (via Node's built-in SQLite) that the schema's single most safety-critical
  invariant holds at the database-constraint level: a wallet cannot claim
  the same `HolderReward` twice. **4/4 checks passed**, including a
  foreign-key rejection case.

**NOT DONE — genuinely blocked, not skipped:**
- No real Postgres migration. This sandbox has no internet, so neither the
  Prisma CLI nor a Postgres server could be installed. `schema.prisma`
  itself has not been run through `prisma migrate dev` against a real
  database. The SQLite smoke test above checks one relational invariant
  using hand-written DDL that mirrors a slice of the real schema — it is
  **not** proof that `schema.prisma` itself is free of typos or that every
  one of its 23 models migrates cleanly. Treat Stage 2 as genuinely
  incomplete until `prisma migrate dev` has actually been run once, with
  internet access, against `docker-compose.yml`'s Postgres.

## Stage 3 completion report — API skeleton

**COMPLETED:**
- `apps/api` — a real HTTP server, deliberately built on Node's built-in
  `http` module with zero external dependencies (Fastify/Express couldn't
  be installed here — no internet). Route handlers are plain
  `(req) => response` functions, which maps directly onto Fastify's
  handler shape, so swapping the router later is mechanical, not a
  redesign.
- Working endpoints, actually started and exercised with real `curl`
  requests (full transcript in the delivery message, not summarized
  here):
  - `GET /health` → 200, real timestamp
  - `GET /health/database` → 503 `not_configured`, honestly, since no DB
    connection exists in this sandbox — never faked as `ok`
  - `GET /api/v1/chains` → real data straight from `@launchpad/config`
  - `POST /api/v1/tax/preview` → real computation via the already-tested
    `computeTaxSplit`; verified against the same $1000 example from the
    Stage 1 tests (2000000000 platform / 1000000000 holder on 100000000000
    gross, matching 2%/1% exactly — field renamed from `creator` to
    `platform` at Stage 6, see above)
  - Invalid tax config → 422 with a clear message, not a silent 200
- Every other route the spec lists (`/api/v1/trades`, `/api/v1/holders`,
  etc.) is registered and returns a `501 NOT_IMPLEMENTED` naming which
  stage will actually build it — never fake data, per spec section 41.
  Full list in `apps/api/src/server.ts`.
- Unknown routes correctly 404.

**NOT DONE:**
- No business logic beyond tax preview and chain listing — everything
  that needs the database or an indexer is honestly stubbed, per above.
- No request validation library (Zod) wired in yet — `previewTax`
  hand-validates its one input; this should be replaced with a shared
  schema-validation layer before more routes gain real logic (Stage 19,
  pulled earlier if it starts feeling repetitive).

**TEST RESULTS (this session):**
- `packages/database/tests/schema-smoke.test.ts`: **4/4 passed**.
- Live server exercised with 7 real `curl` requests covering the happy
  path, an invalid-input path, an honest stub, and a 404 — all responded
  exactly as designed.
- `tsc --noEmit --strict` on the new `apps/api/src` files: fails **only**
  on missing `@types/node` (same pre-existing, disclosed limitation from
  Stage 1 — `console`, `process`, `Buffer`, `URL`, `node:http`'s types
  aren't resolvable without installing `@types/node`, which needs
  internet this sandbox doesn't have). Zero *logic* errors — the runtime
  proof above is what actually demonstrates correctness here, not the
  type-checker.

**KNOWN LIMITATIONS (carried forward + new):**
- Same root cause as Stage 1: no internet in this sandbox. Everything
  above marked "real" was actually run; everything blocked by needing an
  install is named specifically, not glossed over.
- The SQLite smoke test is a narrow, single-invariant check — it does not
  substitute for actually running `prisma migrate dev`.

## Stage 1 completion report

**COMPLETED:**
- Repository structure (`apps/`, `packages/`, `contracts/`, `docs/`, `docker/`)
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint/Prettier config
- `packages/types` — shared types, chain enums, `TaxConfig`, `DataPoint<T>`, `TxState`
- `packages/utils` — `computeTaxSplit` / `validateTaxConfig`, with 9 passing tests
- `packages/config` — per-chain configuration registry
- `packages/blockchain/src/core` — `BlockchainAdapter` interface
- `packages/dex` — `DexAdapter` interface + `compareRoutes`
- `packages/database/prisma/schema.prisma` — all 22 models from the spec + the join table it implies
- `docker-compose.yml`, `.env.example`
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, this roadmap

**IN PROGRESS:** nothing — Stage 1 is fully closed out.

**NEXT:** Stage 2 (real Postgres migration) and Stage 3 (API skeleton) are
the natural next session's work.

**TEST RESULTS:**
- `packages/utils/tests/tax.test.ts`: **9/9 passed** (run via `npx tsx`, real
  execution, not simulated — output included in the delivery message).
- `tsc --noEmit --strict` across `packages/types`, `packages/utils`,
  `packages/blockchain`, `packages/dex`: **0 errors**.
- `prisma/schema.prisma`: reviewed manually for balanced braces, matching
  relations, and correct types (23 models, all relations two-sided). The
  `prisma validate` CLI could **not** be run — see Known Limitations.

**KNOWN LIMITATIONS:**
- This was built in a sandboxed environment with no internet access, so
  nothing requiring a package install could be installed or run: no
  `pnpm install`, no `prisma generate`/`prisma validate`, no
  `docker compose up`, no Solana/EVM RPC calls. Everything reported as
  "tested" above ran with tools already present in that sandbox (Node,
  TypeScript, tsx) — genuinely executed, not asserted. Anything else
  ("this will work once you `pnpm install`") is a claim to verify yourself
  the first time you do, not something already confirmed here.
- `@types/node` is listed in `package.json` but isn't installed in this
  sandbox, so the test file's use of `console`/`process`/`node:assert`
  only type-checks once you actually run `pnpm install` for real — it does
  run correctly today via `tsx`, which was how the 9/9 result above was
  produced.
- No CI pipeline yet (no internet here to set one up against a real git
  host) — add GitHub Actions (or equivalent) running `tsc --noEmit` +
  `tax.test.ts` at minimum, before Stage 2.
