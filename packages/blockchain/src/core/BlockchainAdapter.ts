/**
 * The interface every chain must implement. apps/api and apps/indexer
 * depend ONLY on this interface, never on a concrete chain's SDK directly
 * — that's what makes "add a new chain later" actually true rather than
 * aspirational. See packages/blockchain/src/solana and .../evm for
 * concrete implementations (Stage 6 / Stage 7).
 */
import type { Chain, TokenIdentity, TxResult, DataPoint } from '@launchpad/types';

export interface TokenSupplyInfo {
  totalSupply: bigint;
  decimals: number;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean | null; // null where the chain has no equivalent concept
}

export interface HolderInfo {
  address: string;
  balance: bigint;
  percentOfSupply: number;
}

export interface TransparencyReport {
  chain: Chain;
  tokenAddress: string;
  fetchedAt: string;
  mintAuthorityActive: DataPoint<boolean>;
  freezeAuthorityActive: DataPoint<boolean>;
  contractVerified: DataPoint<boolean>; // EVM only; DataPoint<'unavailable'> on Solana
  contractUpgradeable: DataPoint<boolean>;
  creatorHoldingPercent: DataPoint<number>;
  top10HolderPercent: DataPoint<number>;
  holderCount: DataPoint<number>;
  liquidityUsd: DataPoint<number>;
  /**
   * Deliberately NOT a field like `safetyScore: number`. Spec section 2/12/41
   * bans converting facts into a score or a "SAFE" verdict — the API and UI
   * must only ever render the individual DataPoint fields above.
   */
}

/**
 * Every chain-specific class (SolanaAdapter, EvmAdapter, ...) implements
 * this. Methods that build a transaction return an UNSIGNED transaction
 * object opaque to the caller — signing always happens in the user's own
 * wallet, never server-side. See docs/SECURITY.md "Never touch a user's keys."
 */
export interface BlockchainAdapter {
  readonly chain: Chain;

  getTokenIdentity(tokenAddress: string): Promise<TokenIdentity | null>;
  getTokenSupplyInfo(tokenAddress: string): Promise<TokenSupplyInfo | null>;
  getTopHolders(tokenAddress: string, limit: number): Promise<HolderInfo[]>;
  getTransparencyReport(tokenAddress: string): Promise<TransparencyReport>;

  /** Builds an unsigned "create token" transaction/instruction set for the
   *  connected wallet to sign. Never signs anything itself. */
  buildCreateTokenTransaction(params: CreateTokenParams): Promise<UnsignedTransaction>;

  /** Submits an already-signed transaction and returns its initial state.
   *  Callers must poll confirmation status separately — this never blocks
   *  until "confirmed". */
  submitTransaction(signedTx: SignedTransaction): Promise<TxResult>;

  getTransactionStatus(signature: string): Promise<TxResult>;
}

export interface CreateTokenParams {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  /** The wallet launching this token. On Solana it becomes the mint authority
   *  during creation. Creator trading fees are handled separately by SIGNAL's
   *  routed trade settlement and are paid in native SOL. */
  launcherAddress: string;
  taxBps: number | null; // legacy/generic fee-policy field; not encoded as a Solana token transfer fee
}

/** Opaque wrapper — real implementations wrap @solana/web3.js's Transaction
 *  or an EVM lib's TransactionRequest. Nothing outside the adapter for that
 *  chain should need to know the concrete shape. */
export interface UnsignedTransaction {
  chain: Chain;
  opaquePayload: unknown;
  humanSummary: string[]; // lines shown to the user before they sign, spec section 51
  /** Chain-specific extra data the caller may need before this transaction
   *  is confirmed — e.g. Solana's newly generated (not-yet-on-chain) mint
   *  address. Optional so existing callers/adapters are unaffected. */
  metadata?: Record<string, unknown>;
}

export interface SignedTransaction {
  chain: Chain;
  opaquePayload: unknown;
}
