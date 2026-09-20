# Security — Stage 1 baseline

This is the security posture as of Stage 1 (architecture only, nothing
deployed). Revisit and expand this at Stage 19 before any testnet
deployment, and again before any mainnet deployment — this file is meant
to grow, not stay static.

## Non-negotiables, already true of every interface in this repo

- **No adapter method ever takes a private key or seed phrase.**
  `BlockchainAdapter` and `DexAdapter` methods that build transactions
  return an *unsigned* transaction; signing happens exclusively in the
  user's own wallet (Phantom, MetaMask, etc.). Grep the codebase for
  `privateKey` or `secretKey` outside of `contracts/` test fixtures — if
  you ever find one in application code, that's a bug, not a feature.
- **No admin function can move user funds.** Spec section 30's rule
  ("never create an admin function capable of arbitrarily stealing or
  moving user funds") is a hard constraint on `apps/api`'s admin routes
  (Stage 18) and on the on-chain authority design (Stage 6). Under the
  current model (2026-09-17), Signal holds no fee-related authority or
  key at all — the token's own creator holds mint authority, transfer-
  fee-config authority, and withdraw-withheld authority, all on one
  wallet. There is no Signal god-key here because there is no Signal
  role in fee collection to begin with.
- **Every privileged action is logged.** `AuditLog` + `AdminUser` models
  exist in the schema now specifically so Stage 18 can't be built without
  them.
- **Facts, not scores.** `TransparencyReport` (in `BlockchainAdapter.ts`)
  has no `safetyScore` field and never will — see spec section 2/12.

## The single-key-controls-everything model (Solana transfer-fee mechanism)

Carried over from the original single-chain build: whoever holds the
wallet set as `transferFeeConfigAuthority` / `withdrawWithheldAuthority`
on a token's mint controls that token's transfer-fee settings and can
withdraw collected fees. There is no way to make a *token-level*
authority multi-party without a multisig wallet (e.g. Squads on Solana)
holding that role instead of a single keypair — worth doing before real
money is involved, and out of scope for Stage 1 to implement, but
flagged here so it isn't forgotten at Stage 6.

**Update (2026-09-17, historical — see the 2026-09-19 update below for
the current state):** this authority briefly moved to a fixed Signal
platform wallet (splitting
the fee 2% platform / 1% holder-reward pool), twice, before being
confirmed back to the original model: 100% to the token's own creator,
who holds `transferFeeConfigAuthority` and `withdrawWithheldAuthority`,
same wallet as `mintAuthority`. `SolanaFeeOperations.ts`, the
platform-wallet config, and the worker script that implemented the
platform/holder version have been deleted, not just deprecated. See
docs/ROADMAP.md Stage 6 for the complete back-and-forth history.

**Update (2026-09-19, current state — see ADR-0011 in
docs/ARCHITECTURE.md):** `transferFeeConfigAuthority` and
`withdrawWithheldAuthority` now belong to a real Signal platform wallet
(`SIGNAL_PLATFORM_WALLET`) again — not the reversal-of-a-reversal
version from 2026-09-17 above, but a direct, explicit instruction with
a real wallet address, two days later. `mintAuthority` remains the
creator's own wallet; only the two fee authorities changed. The token's
creator now receives 0% of the Signal Fee — 100% goes to the platform
wallet. A separate, one-time 1% Launch Fee also exists as real, tested
logic (`computeLaunchFeeFromPayment`) but is not currently charged
anywhere, since no base launch payment has ever been defined in this
product for it to apply to.

## Creator key security — what actually applies now

**Who signs harvest/withdraw transactions?** The token's own creator —
the same wallet that has mint authority.
`SolanaAdapter.buildHarvestAndWithdrawTransactions` returns an unsigned
transaction for that wallet to sign, same as every other method in the
class. Signal never signs, never holds a key, and has no operational
role in fee collection at all.

**Where is that key stored, and how is it protected?** Entirely the
creator's own responsibility — this is no different from holding any
Solana wallet with real value in it. The general wallet-custody guidance
above (hardware wallet for real funds, never share a private key,
generate fresh keys per project) applies to the creator directly. Signal
has nothing to store, protect, or lose here.

**How is the fee destination verified?** By the chain itself:
`withdrawWithheldAuthority` is a field on the mint, publicly readable by
anyone via `SolanaAdapter.readTransferFeeConfig` or any block explorer.
Since it's the creator's own wallet, "verifying the destination" is
exactly the same act as verifying who created the token — no separate
constant or fail-loud check is needed the way it would be if a third
party were supposed to be the recipient.

**What changed in the risk profile, honestly:** simpler is safer here.
There is no Signal fee authority, no platform wallet, and no
rewards-pool authority to compromise — those categories of risk simply
don't exist under this model. What's left is the ordinary risk of a
creator managing their own wallet — real, but not a new or
platform-specific risk this project introduced.

## Known gaps at Stage 1 (expected — not yet built)

- No authentication system yet (Stage 3/19).
- No rate limiting yet (Stage 19). **Update, still true when this list
  itself was written "at Stage 1" above but stale since**: chat now has
  real, server-enforced per-wallet rate limiting (see
  `apps/api/src/chat/MemoryChatRepository.ts`/`PrismaChatRepository.ts`).
  What's still genuinely missing is rate limiting *outside* chat —
  `/api/v1/tokens/register` and the tax-preview endpoint have none yet.
- No input validation middleware yet — `packages/security` is an empty
  package waiting for Stage 19's Zod schemas.
- No contracts exist yet to audit (Stage 6/7, audit before mainnet per
  spec section 43).
- No secrets management beyond `.env` files — fine for local dev, not
  fine for production (Stage 20 deployment should use a real secrets
  manager, not `.env` files on a server).

## Before mainnet — the checklist that matters most

Everything above is code-level. Two things code review alone can't cover,
worth saying plainly:

1. **A professional smart-contract audit**, specifically covering the
   transfer-fee accounting math (the one place money moves without a
   human approving each transfer individually). Spec section 43 already
   says this; repeating it here because it's the single highest-leverage
   thing standing between "looks correct" and "is correct."
2. **Legal review for your jurisdiction(s).** A platform that lets anyone
   launch a token with an automatic transfer fee has
   real securities-law and money-transmission-law surface area in a lot
   of jurisdictions, independent of how well the code is written. This is
   a lawyer conversation, not an engineering one — worth having before,
   not after, real users show up.
