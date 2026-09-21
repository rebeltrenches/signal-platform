/**
 * Shared types used across every app and package in the monorepo.
 * This is the contract every chain adapter, DEX adapter, and API route
 * agrees to — changing a type here is a breaking change everywhere.
 */

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/** Chains with a working adapter today. */
export type ActiveChain = 'solana' | 'base' | 'bnb';

/** Chains the architecture is designed for but not implemented yet.
 *  Adding one of these later should only mean: implement a new
 *  BlockchainAdapter + DexAdapter, add a ChainConfig entry, add a
 *  migration. Nothing in apps/api or apps/web should need to change.
 *  'robinhood' added 2026-09-17 (master spec section 22) — deliberately
 *  separated into discovery vs. deployment capability in ChainConfig
 *  below, since the spec explicitly wants those treated independently. */
export type PlannedChain =
  | 'ethereum'
  | 'arbitrum'
  | 'avalanche'
  | 'polygon'
  | 'sui'
  | 'ton'
  | 'robinhood';

export type Chain = ActiveChain | PlannedChain;

export type ChainFamily = 'svm' | 'evm' | 'move' | 'ton';

// ---------------------------------------------------------------------------
// Money — NEVER use `number` for on-chain amounts or USD values.
// Base units as bigint (raw on-chain integer), decimals tracked separately.
// See packages/utils/src/money.ts for the arithmetic helpers.
// ---------------------------------------------------------------------------

export interface TokenAmount {
  /** Raw base-unit amount, e.g. lamports / wei. Never a float. */
  raw: bigint;
  decimals: number;
}

// ---------------------------------------------------------------------------
// Transaction tax (protocol-level, per token)
// ---------------------------------------------------------------------------

/** Basis points: 300 = 3.00%. Integer only — never a float percentage. */
export type BasisPoints = number;

export const PROTOCOL_MAX_TAX_BPS: BasisPoints = 1000; // 10% hard ceiling, enforced in code AND on-chain

/** Minimum total token supply a launch may mint, enforced independently
 *  on both the wizard's own input validation (immediate feedback) and
 *  the actual transaction-building step (the real gate — nothing
 *  upstream of it can be trusted alone). Below this, a launch is
 *  refused before any wallet ever sees a signing prompt. Base units are
 *  irrelevant here — this is whole tokens, before decimals scaling. */
export const MINIMUM_TOKEN_SUPPLY = 100_000_000;

/** SUPERSEDED again (see docs/ROADMAP.md for the full history of this
 *  type's changes) — confirmed final: a 1% creator transfer fee, 100% of which goes to the token creator. There is no Signal platform share and no holder-reward split.
 *  The two near-duplicate TaxConfig declarations and layered "SUPERSEDED/
 *  CONFIRMED" comments that used to sit here (one per historical
 *  reversal, never cleaned up) are consolidated into this single
 *  declaration during this change. */
export interface TaxConfig {
  enabled: boolean;
  totalBps: BasisPoints;
}

/** Today's actual default: 1% creator transfer fee. 100% goes to the token creator; Signal receives 0% and holder rewards receive 0%. */
export const DEFAULT_TAX_CONFIG: TaxConfig = {
  enabled: true,
  totalBps: 100,
};

/** EVM chains (Base, BNB) do not get a transfer-fee mechanism yet — see
 *  ADR-0003 in docs/ARCHITECTURE.md. Trading/discovery only until a
 *  custom tax contract exists and is audited. */
export const DISABLED_TAX_CONFIG: TaxConfig = {
  enabled: false,
  totalBps: 0,
};

/** No separate Signal launch/platform fee is charged. */
export const LAUNCH_FEE_BPS: BasisPoints = 0;

// ---------------------------------------------------------------------------
// Token / Launch
// ---------------------------------------------------------------------------

export type LaunchStatus = 'draft' | 'bonding' | 'graduated' | 'failed';

export interface TokenIdentity {
  chain: Chain;
  address: string; // mint address (Solana) or contract address (EVM)
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
  /** Master spec section 23 ("Universal Token Discovery"): a token
   *  Signal can show doesn't have to have been created here. This is
   *  DataPoint, not a bare boolean, because for a real address the
   *  adapter hasn't looked up yet, "was this launched on Signal" is
   *  itself a fact to fetch (check the `Token` table for a matching
   *  row), not something to assume true or false by default. */
  launchedOnSignal: DataPoint<boolean>;
}

// ---------------------------------------------------------------------------
// Transactions — explicit state machine (spec section 50).
// UI must never show a state that skips ahead of what's actually confirmed.
// ---------------------------------------------------------------------------

export type TxState =
  | 'created'
  | 'simulating'
  | 'awaiting_signature'
  | 'signed'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'expired';

export interface TxResult {
  state: TxState;
  signature: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Data-availability wrapper — spec section 3/10/41: never fabricate a metric.
// Every indexed/external value on the frontend is wrapped in this, so
// "we don't have this" and "this is zero" can never be confused.
// ---------------------------------------------------------------------------

export type DataPoint<T> =
  | { status: 'available'; value: T; asOf: string }
  | { status: 'unavailable' };

// ---------------------------------------------------------------------------
// Evidence / verification — master spec sections 11 ("Signal Verification")
// and 13 ("Transparency Center"). Every piece of information Signal shows
// about a token or wallet must be traceable to one of these sources — never
// presented as if Signal itself vouches for something it only relayed.
// Never converted into a safety score or a "safe"/"scam" verdict (spec
// sections 2/11/12); the UI shows the source and the fact, and the person
// draws their own conclusion.
// ---------------------------------------------------------------------------

export type EvidenceSource =
  | 'blockchain-derived' // read directly from on-chain state (e.g. via BlockchainAdapter)
  | 'signal-verified' // Signal independently confirmed this through its own process
  | 'creator-provided' // the token's creator supplied this (name, description, socials, etc.)
  | 'third-party' // an external API or data provider
  | 'community-reported'; // submitted by a user, unverified by Signal

/** A DataPoint that also carries where it came from, so the UI can label
 *  facts by their evidence source rather than implying Signal generated
 *  or verified everything shown. */
export interface SourcedDataPoint<T> {
  point: DataPoint<T>;
  source: EvidenceSource;
}

export function sourcedAvailable<T>(value: T, source: EvidenceSource): SourcedDataPoint<T> {
  return { point: { status: 'available', value, asOf: new Date().toISOString() }, source };
}
export function sourcedUnavailable<T>(source: EvidenceSource): SourcedDataPoint<T> {
  return { point: { status: 'unavailable' }, source };
}

// ---------------------------------------------------------------------------
// Wallet Intelligence — master spec sections 14/15. Mirrors
// packages/database/prisma/schema.prisma's WalletRelationship/WalletNote
// models exactly (kept in sync manually, same reason as EvidenceSource
// above). NEVER claim two wallets belong to the same person without
// reliable evidence — that's why RelationshipType below describes what
// was OBSERVED, not a conclusion about identity.
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'low' | 'medium' | 'high'; // never "certain" — evidence-based, not proof

export type WalletRelationshipType =
  | 'funded' // wallet A sent funds to wallet B
  | 'received_from' // the inverse view of 'funded'
  | 'shared_liquidity_pool' // both wallets have positions in the same pool
  | 'co_signed_transaction'; // both wallets signed the same transaction

export interface WalletRelationship {
  relatedWalletAddress: string;
  relationshipType: WalletRelationshipType;
  evidenceSource: EvidenceSource;
  evidenceDescription: string; // human-readable, references the real observation
  confidenceLevel: ConfidenceLevel;
  observedTxSignature: string | null;
}

/** "Signal Passport" (spec section 15) — an evidence-linked summary for
 *  one wallet. Explicitly NOT a safety certificate or endorsement (the
 *  spec's own words) — every field is either a DataPoint (honest
 *  "unavailable" when not indexed) or a list of relationships, each with
 *  its own evidence. Nothing here is ever a score. */
export interface WalletPassport {
  address: string;
  chain: Chain;
  tokensLaunched: DataPoint<number>;
  firstActivityAt: DataPoint<string>;
  relationships: WalletRelationship[];
  notes: Array<{ note: string; evidenceSource: EvidenceSource; evidenceTxSignature: string | null }>;
}

