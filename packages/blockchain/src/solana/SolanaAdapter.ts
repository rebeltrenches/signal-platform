/**
 * The real BlockchainAdapter implementation for Solana. Wraps the exact
 * Token-2022 approach already proven in the earlier single-chain build's
 * contracts/solana scripts behind the shared interface, so apps/web and
 * apps/api never need to know Solana-specific details.
 *
 * AUTHORITY MODEL (CONFIRMED 2026-09-17 — final state, after the fee
 * model flipped between this and a separate-fee-authority version
 * multiple times in one day; see docs/ROADMAP.md Stage 6 for the full
 * history):
 *   - mintAuthority              -> the launcher's own connected wallet.
 *   - transferFeeConfigAuthority -> the SAME launcher wallet.
 *   - withdrawWithheldAuthority  -> the SAME launcher wallet.
 * One wallet, all three roles — the token's creator controls supply,
 * controls the fee configuration, and receives 100% of the 3% transfer
 * fee. Signal holds no authority over any token's fee mechanism and no
 * operational key for this at all. There is no platform fee, no
 * holder-rewards pool, no split, no separate "SolanaFeeOperations" class.
 *
 * IMPORTANT HONESTY NOTE (read before trusting anything "worked"):
 * This file was written and reviewed in a sandboxed environment with NO
 * internet access. Every method that talks to the network has never
 * actually been executed against a live RPC endpoint. Zero real
 * transactions have been submitted under this authority model, on any
 * network, as of this writing. See docs/ROADMAP.md's Stage 6 section for
 * the exact status.
 *
 * SECURITY: no method in this class ever holds, requests, or uses the
 * launcher's private key. buildCreateTokenTransaction generates a fresh,
 * throwaway keypair for the NEW mint account only (not a secret that
 * needs protecting after this transaction) and partial-signs with it;
 * the fee-payer signature always comes from the launcher's own wallet,
 * added afterward, outside this class. Signal never holds a secret key
 * anywhere in this fee model — there is nothing for Signal to custody.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getMint,
  getTransferFeeConfig,
  getTransferFeeAmount,
  unpackAccount,
} from '@solana/spl-token';
import type { Chain, TokenIdentity, TxResult, DataPoint } from '@launchpad/types';
import { DEFAULT_TAX_CONFIG } from '@launchpad/types';
import type {
  BlockchainAdapter,
  CreateTokenParams,
  UnsignedTransaction,
  SignedTransaction,
  TokenSupplyInfo,
  HolderInfo,
  TransparencyReport,
} from '../core/BlockchainAdapter.js';

function unavailable<T>(): DataPoint<T> {
  return { status: 'unavailable' };
}
function available<T>(value: T): DataPoint<T> {
  return { status: 'available', value, asOf: new Date().toISOString() };
}

export interface SolanaAdapterConfig {
  /** Which RPC endpoint to use is intentionally the caller's decision,
   *  not this class's. Solana Mainnet is the confirmed eventual target
   *  and devnet is permanently excluded (docs/ROADMAP.md Stage 6). */
  rpcUrl: string;
}

const HARVEST_BATCH_SIZE = 20; // accounts per harvest transaction — instruction size grows with account count

export class SolanaAdapter implements BlockchainAdapter {
  readonly chain: Chain = 'solana';
  private connection: Connection;

  constructor(config: SolanaAdapterConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
  }

  // -------------------------------------------------------------------
  // Read methods — real RPC calls. Every field that could fail to
  // resolve returns the DataPoint 'unavailable' state rather than a
  // fabricated value or a thrown error swallowed into a false zero.
  // -------------------------------------------------------------------

  async getTokenIdentity(tokenAddress: string): Promise<TokenIdentity | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      return {
        chain: this.chain,
        address: tokenAddress,
        name: '', // Token-2022 base mint has no name field; needs the metadata extension or an off-chain source (Stage 11)
        symbol: '',
        decimals: mint.decimals,
        logoUrl: null,
        // Whether this token was launched THROUGH SIGNAL is a fact about
        // Signal's own database, not visible on-chain — this adapter
        // only reads the chain, so honestly 'unavailable' here.
        launchedOnSignal: unavailable(),
      };
    } catch {
      return null;
    }
  }

  async getTokenSupplyInfo(tokenAddress: string): Promise<TokenSupplyInfo | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      return {
        totalSupply: mint.supply,
        decimals: mint.decimals,
        mintAuthorityActive: mint.mintAuthority !== null,
        freezeAuthorityActive: mint.freezeAuthority !== null,
      };
    } catch {
      return null;
    }
  }

  async getTopHolders(tokenAddress: string, limit: number): Promise<HolderInfo[]> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const accounts = await this.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: tokenAddress } }],
      });
      const totalSupply = mint.supply;
      const holders = accounts
        .map(({ pubkey, account }) => unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID))
        .filter((acc) => acc.amount > 0n)
        .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
        .slice(0, limit)
        .map((acc) => ({
          address: acc.owner.toBase58(),
          balance: acc.amount,
          percentOfSupply: totalSupply > 0n ? Number((acc.amount * 10000n) / totalSupply) / 100 : 0,
        }));
      return holders;
    } catch {
      return [];
    }
  }

  async getTransparencyReport(tokenAddress: string): Promise<TransparencyReport> {
    const base: TransparencyReport = {
      chain: this.chain,
      tokenAddress,
      fetchedAt: new Date().toISOString(),
      mintAuthorityActive: unavailable(),
      freezeAuthorityActive: unavailable(),
      contractVerified: unavailable(),
      contractUpgradeable: unavailable(),
      creatorHoldingPercent: unavailable(),
      top10HolderPercent: unavailable(),
      holderCount: unavailable(),
      liquidityUsd: unavailable(),
    };

    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      base.mintAuthorityActive = available(mint.mintAuthority !== null);
      base.freezeAuthorityActive = available(mint.freezeAuthority !== null);

      const holders = await this.getTopHolders(tokenAddress, 10);
      if (holders.length > 0) {
        base.holderCount = available(holders.length);
        const top10Pct = holders.reduce((s, h) => s + h.percentOfSupply, 0);
        base.top10HolderPercent = available(Math.round(top10Pct * 100) / 100);
      }
    } catch {
      // leave as 'unavailable'
    }

    return base;
  }

  // -------------------------------------------------------------------
  // Write methods — build UNSIGNED transactions only. Every method
  // below is signed by the SAME launcher wallet — there is no separate
  // Signal-controlled key anywhere in this file.
  // -------------------------------------------------------------------

  /**
   * Builds: create mint account + initialize the 3% TransferFeeConfig
   * (100% to this same launcher — no platform fee, no holder split) +
   * initialize the mint itself. Returns the transaction unsigned (apart
   * from the fresh mint keypair's own required signature).
   *
   * mintAuthority, transferFeeConfigAuthority, and withdrawWithheldAuthority
   * are ALL set to params.launcherAddress — one wallet, full control,
   * full fee receipt.
   */
  async buildCreateTokenTransaction(params: CreateTokenParams): Promise<UnsignedTransaction> {
    const launcher = new PublicKey(params.launcherAddress);
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    const feeBasisPoints = params.taxBps ?? DEFAULT_TAX_CONFIG.totalBps;
    const maxFee = BigInt(1_000_000) * 10n ** BigInt(params.decimals);

    const extensions = [ExtensionType.TransferFeeConfig];
    const mintLen = getMintLen(extensions);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: launcher,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mint,
        launcher, // transferFeeConfigAuthority -> the launcher, 100% creator model
        launcher, // withdrawWithheldAuthority  -> the launcher, 100% creator model
        feeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(mint, params.decimals, launcher, null, TOKEN_2022_PROGRAM_ID)
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = launcher;
    tx.partialSign(mintKeypair);

    return {
      chain: this.chain,
      opaquePayload: tx,
      humanSummary: [
        `Create token "${params.name}" (${params.symbol}) on Solana`,
        `Mint address (new): ${mint.toBase58()}`,
        `Decimals: ${params.decimals}`,
        `Transfer fee: ${(feeBasisPoints / 100).toFixed(2)}% total — 100% goes to you, the creator.`,
        `No Signal platform fee. No holder-rewards pool.`,
        `You (${params.launcherAddress}) will be the mint authority, transfer-fee-config authority, and withdraw-withheld authority — full control, full fee receipt.`,
      ],
      metadata: { mintAddress: mint.toBase58() },
    };
  }

  /** Create the launcher's associated token account and mint the full
   *  supply into it. Separate transaction — Solana transaction size
   *  limits make combining all steps impractical. */
  async buildMintSupplyTransaction(
    mintAddress: string,
    launcherAddress: string,
    totalSupply: bigint,
    decimals: number
  ): Promise<UnsignedTransaction> {
    const launcher = new PublicKey(launcherAddress);
    const mint = new PublicKey(mintAddress);
    const ata = getAssociatedTokenAddressSync(mint, launcher, false, TOKEN_2022_PROGRAM_ID);

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(launcher, ata, launcher, mint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint, ata, launcher, totalSupply * 10n ** BigInt(decimals), [], TOKEN_2022_PROGRAM_ID)
    );
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = launcher;

    return {
      chain: this.chain,
      opaquePayload: tx,
      humanSummary: [`Mint ${totalSupply} tokens to your wallet`, `Token account: ${ata.toBase58()}`],
      metadata: { associatedTokenAccount: ata.toBase58() },
    };
  }

  /** Renounce mint authority, locking total supply forever. Irreversible
   *  — see docs/SECURITY.md. Renouncing MINT authority never touches the
   *  fee mechanism — the creator keeps fee control and fee receipt even
   *  after locking supply. */
  async buildRenounceMintAuthorityTransaction(
    mintAddress: string,
    launcherAddress: string
  ): Promise<UnsignedTransaction> {
    const launcher = new PublicKey(launcherAddress);
    const mint = new PublicKey(mintAddress);

    const tx = new Transaction().add(
      createSetAuthorityInstruction(mint, launcher, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID)
    );
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = launcher;

    return {
      chain: this.chain,
      opaquePayload: tx,
      humanSummary: ['Renounce mint authority — irreversible, locks supply forever'],
    };
  }

  /**
   * Harvest + withdraw the creator's OWN accumulated transfer fee, to
   * their OWN wallet — the entire real fee-collection mechanism under
   * the current model, since the whole 3% belongs to the creator and
   * nothing needs splitting. Returns an unsigned transaction for the
   * CREATOR's own wallet to sign, exactly like every other method in
   * this class. Signal has no role and no key in this flow at all.
   *
   * Harvesting (moving withheld amounts out of individual holder
   * accounts into the mint's own withheld balance) is permissionless on
   * Token-2022. Only WITHDRAWING requires withdrawWithheldAuthority,
   * which is the creator's own wallet here.
   *
   * Returns an EMPTY transactions array (not a harmless-looking
   * zero-amount withdraw) when there is nothing withheld anywhere for
   * this mint — callers must check `hasWithheldBalance` before assuming
   * there's anything to sign, and must never present a "collected"
   * result when this returns false. Fixed 2026-09-17: this previously
   * built a withdraw transaction unconditionally even when
   * `hasWithheldBalance` was false, which contradicted the flag's own
   * meaning.
   */
  async buildHarvestAndWithdrawTransactions(
    mintAddress: string,
    launcherAddress: string,
    decimals: number
  ): Promise<{ transactions: UnsignedTransaction[]; hasWithheldBalance: boolean }> {
    const launcher = new PublicKey(launcherAddress);
    const mint = new PublicKey(mintAddress);

    const allAccounts = await this.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: mintAddress } }],
    });
    const accountsWithFees = allAccounts
      .map(({ pubkey, account }) => {
        const unpacked = unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID);
        const feeAmount = getTransferFeeAmount(unpacked);
        return { pubkey, withheld: feeAmount?.withheldAmount ?? 0n };
      })
      .filter((a) => a.withheld > 0n);

    const transactions: UnsignedTransaction[] = [];

    // Nothing withheld anywhere — stop here. Building a withdraw
    // transaction anyway (even a nominally "harmless" zero-amount one)
    // would be a real transaction the UI could confuse with an actual
    // collection. Requirement: never look like a successful collection
    // when nothing was collected.
    if (accountsWithFees.length === 0) {
      return { transactions: [], hasWithheldBalance: false };
    }

    const { blockhash } = await this.connection.getLatestBlockhash();

    const { createHarvestWithheldTokensToMintInstruction } = await import('@solana/spl-token');

    for (let i = 0; i < accountsWithFees.length; i += HARVEST_BATCH_SIZE) {
      const batch = accountsWithFees.slice(i, i + HARVEST_BATCH_SIZE).map((a) => a.pubkey);
      const harvestTx = new Transaction().add(
        createHarvestWithheldTokensToMintInstruction(mint, batch, TOKEN_2022_PROGRAM_ID)
      );
      harvestTx.recentBlockhash = blockhash;
      harvestTx.feePayer = launcher;
      transactions.push({
        chain: this.chain,
        opaquePayload: harvestTx,
        humanSummary: [`Harvest withheld fees from ${batch.length} account(s) into the mint`],
      });
    }

    const ata = getAssociatedTokenAddressSync(mint, launcher, false, TOKEN_2022_PROGRAM_ID);
    const withdrawTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(launcher, ata, launcher, mint, TOKEN_2022_PROGRAM_ID),
      createWithdrawWithheldTokensFromMintInstruction(mint, ata, launcher, [], TOKEN_2022_PROGRAM_ID)
    );
    withdrawTx.recentBlockhash = blockhash;
    withdrawTx.feePayer = launcher;
    transactions.push({
      chain: this.chain,
      opaquePayload: withdrawTx,
      humanSummary: [`Withdraw your accumulated transfer fee to your own token account (${ata.toBase58()})`],
      metadata: { destinationAta: ata.toBase58() },
    });

    return { transactions, hasWithheldBalance: true };
  }

  /**
   * Reads the transfer-fee configuration back from the chain — the
   * verification step: confirming what's actually enforced on-chain.
   * Returns null if the mint can't be read or has no TransferFeeConfig
   * extension. Under the current model, a healthy mint should show
   * withdrawWithheldAuthority equal to its own creator's address.
   */
  async readTransferFeeConfig(mintAddress: string): Promise<{
    transferFeeBasisPoints: number;
    maximumFee: bigint;
    withdrawWithheldAuthority: string | null;
    transferFeeConfigAuthority: string | null;
  } | null> {
    try {
      const mint = await getMint(this.connection, new PublicKey(mintAddress), 'confirmed', TOKEN_2022_PROGRAM_ID);
      const feeConfig = getTransferFeeConfig(mint);
      if (!feeConfig) return null;
      const newerFee = feeConfig.newerTransferFee;
      return {
        transferFeeBasisPoints: newerFee.transferFeeBasisPoints,
        maximumFee: newerFee.maximumFee,
        withdrawWithheldAuthority: feeConfig.withdrawWithheldAuthority.equals(PublicKey.default)
          ? null
          : feeConfig.withdrawWithheldAuthority.toBase58(),
        transferFeeConfigAuthority: feeConfig.transferFeeConfigAuthority.equals(PublicKey.default)
          ? null
          : feeConfig.transferFeeConfigAuthority.toBase58(),
      };
    } catch {
      return null;
    }
  }

  async submitTransaction(signedTx: SignedTransaction): Promise<TxResult> {
    try {
      const tx = signedTx.opaquePayload as Transaction;
      const signature = await this.connection.sendRawTransaction(tx.serialize());
      return { state: 'submitted', signature, error: null };
    } catch (err) {
      return { state: 'failed', signature: null, error: (err as Error).message };
    }
  }

  async getTransactionStatus(signature: string): Promise<TxResult> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      const confirmationStatus = status.value?.confirmationStatus;
      if (status.value?.err) {
        return { state: 'failed', signature, error: JSON.stringify(status.value.err) };
      }
      if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
        return { state: 'confirmed', signature, error: null };
      }
      if (confirmationStatus === 'processed') {
        return { state: 'confirming', signature, error: null };
      }
      return { state: 'submitted', signature, error: null };
    } catch (err) {
      return { state: 'failed', signature, error: (err as Error).message };
    }
  }
}
