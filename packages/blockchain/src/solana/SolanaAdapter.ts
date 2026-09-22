/**
 * Solana BlockchainAdapter.
 *
 * New SIGNAL launches use the classic SPL Token program. The 1% creator
 * trading fee is settled in native SOL by SIGNAL-routed BUY/SELL trades;
 * it is not a Token-2022 transfer fee. Read paths continue to support both
 * classic SPL Token and Token-2022 mints discovered on-chain.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
  getMint,
  unpackAccount,
} from '@solana/spl-token';
import type { Chain, TokenIdentity, TxResult, DataPoint } from '@launchpad/types';
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

  /**
   * Read paths must support both the original SPL Token program and
   * Token-2022. Signal-created mints use Token-2022, but Stage 11 may
   * index already-registered Solana tokens that use the legacy program.
   */
  private async getMintProgramId(mintPubkey: PublicKey): Promise<PublicKey> {
    const account = await this.connection.getAccountInfo(mintPubkey, 'confirmed');
    if (!account) throw new Error('Mint account not found.');
    if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    if (account.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
    throw new Error(`Unsupported token program: ${account.owner.toBase58()}`);
  }

  // -------------------------------------------------------------------
  // Read methods — real RPC calls. Every field that could fail to
  // resolve returns the DataPoint 'unavailable' state rather than a
  // fabricated value or a thrown error swallowed into a false zero.
  // -------------------------------------------------------------------

  async getTokenIdentity(tokenAddress: string): Promise<TokenIdentity | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const programId = await this.getMintProgramId(mintPubkey);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', programId);
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
      const programId = await this.getMintProgramId(mintPubkey);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', programId);
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
      const programId = await this.getMintProgramId(mintPubkey);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', programId);
      // Ask the RPC for only the mint's largest token accounts instead of
      // scanning every account owned by the token program. Public Solana RPC
      // endpoints may reject/limit the broad getProgramAccounts query.
      const largest = await this.connection.getTokenLargestAccounts(mintPubkey, 'confirmed');
      const selected = largest.value.slice(0, limit);
      const accountInfos = await this.connection.getMultipleAccountsInfo(
        selected.map((entry) => entry.address),
        'confirmed'
      );
      const totalSupply = mint.supply;
      const holders = selected.flatMap((entry, index) => {
        const account = accountInfos[index];
        if (!account) return [];
        const unpacked = unpackAccount(entry.address, account, programId);
        if (unpacked.amount <= 0n) return [];
        return [{
          address: unpacked.owner.toBase58(),
          balance: unpacked.amount,
          percentOfSupply: totalSupply > 0n ? Number((unpacked.amount * 10000n) / totalSupply) / 100 : 0,
        }];
      });
      return holders;
    } catch (error) {
      // An empty array is a valid holder snapshot, so it must never also
      // mean "the RPC failed". Propagate read failures to the indexer so
      // saveIndexedData is not called and the last known-good holder
      // snapshot remains intact.
      throw error;
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
      const programId = await this.getMintProgramId(mintPubkey);
      const mint = await getMint(this.connection, mintPubkey, 'confirmed', programId);
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
  // Write methods — build UNSIGNED transactions only. Token creation and
  // mint-authority actions are signed by the launcher's own wallet;
  // fee-collection (buildHarvestAndWithdrawTransactions) is signed by
  // the token creator instead, since it alone holds
  // withdrawWithheldAuthority under the current fee model. Signal never
  // holds either wallet's private key — this file only ever builds
  // unsigned transactions for each wallet's own holder to sign.
  // -------------------------------------------------------------------

  /**
   * Build a classic SPL Token mint transaction. Trading fees are not encoded
   * into the mint; SIGNAL's trade settlement handles the creator's 1% in SOL.
   */
  async buildCreateTokenTransaction(params: CreateTokenParams): Promise<UnsignedTransaction> {
    const launcher = new PublicKey(params.launcherAddress);
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    // New SIGNAL launches use the classic SPL Token mint. Creator trading
    // fees are settled in native SOL by the SIGNAL trade path, never by a
    // Token-2022 transfer-fee extension.
    const mintLen = 82;
    const lamports = await this.connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: launcher,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint, params.decimals, launcher, null, TOKEN_PROGRAM_ID)
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
        `Network rent for this mint account: ${lamports} lamports — paid to Solana itself, not to Signal.`,
        `Creator trading fee: 1% of the SOL side on SIGNAL-routed trades — paid in native SOL to the token creator.`,
        `You (${params.launcherAddress}) will be the mint authority — you can mint additional supply.`,

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
    const ata = getAssociatedTokenAddressSync(mint, launcher, false, TOKEN_PROGRAM_ID);

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(launcher, ata, launcher, mint, TOKEN_PROGRAM_ID),
      createMintToInstruction(mint, ata, launcher, totalSupply * 10n ** BigInt(decimals), [], TOKEN_PROGRAM_ID)
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
   *  fee mechanism — the token creator keeps fee control and
   *  fee receipt regardless of whether the launcher renounces supply
   *  control. */
  async buildRenounceMintAuthorityTransaction(
    mintAddress: string,
    launcherAddress: string
  ): Promise<UnsignedTransaction> {
    const launcher = new PublicKey(launcherAddress);
    const mint = new PublicKey(mintAddress);

    const tx = new Transaction().add(
      createSetAuthorityInstruction(mint, launcher, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID)
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

  /** Legacy interface hook: Token-2022 withheld-token collection is disabled. */
  async buildHarvestAndWithdrawTransactions(
    _mintAddress: string,
    _decimals: number,
    _creatorAddress: string
  ): Promise<{ transactions: UnsignedTransaction[]; hasWithheldBalance: boolean }> {
    // Disabled by design. SIGNAL no longer creates Token-2022 transfer-fee
    // mints; creator trading fees are paid in native SOL during routed trades.
    return { transactions: [], hasWithheldBalance: false };
  }

  async readTransferFeeConfig(_mintAddress: string): Promise<null> {
    return null;
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
