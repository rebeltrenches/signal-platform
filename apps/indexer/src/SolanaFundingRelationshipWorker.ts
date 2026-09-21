import { PublicKey, SystemProgram, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { ensureWallet, type WalletCapableClient } from '../../api/src/db/ensureWallet.js';

export interface SolanaFundingReader {
  getSignaturesForAddress(address: PublicKey, options?: { limit?: number }): Promise<Array<{ signature: string; err: unknown | null }>>;
  getParsedTransaction(signature: string, options?: { maxSupportedTransactionVersion?: number }): Promise<ParsedTransactionWithMeta | null>;
}

export interface WalletRelationshipClient extends WalletCapableClient {
  walletRelationship: {
    findFirst(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
}

export interface FundingDiscoveryResult {
  scanned: number;
  discovered: number;
  skipped: number;
}

function directSolTransfers(tx: ParsedTransactionWithMeta): Array<{ from: string; to: string; lamports: number }> {
  const transfers: Array<{ from: string; to: string; lamports: number }> = [];
  for (const instruction of tx.transaction.message.instructions) {
    if (!('parsed' in instruction) || instruction.program !== 'system') continue;
    const parsed = instruction.parsed as { type?: string; info?: Record<string, unknown> };
    if (parsed.type !== 'transfer') continue;
    const info = parsed.info ?? {};
    const from = typeof info.source === 'string' ? info.source : null;
    const to = typeof info.destination === 'string' ? info.destination : null;
    const lamports = typeof info.lamports === 'number' ? info.lamports : null;
    if (!from || !to || !lamports || lamports <= 0) continue;
    transfers.push({ from, to, lamports });
  }
  return transfers;
}

/**
 * Discovers only explicit System Program SOL transfers involving the target
 * wallet. A transfer is evidence of a fund flow, never evidence of common
 * ownership or identity.
 */
export class SolanaFundingRelationshipWorker {
  constructor(
    private readonly rpc: SolanaFundingReader,
    private readonly db: WalletRelationshipClient,
    private readonly signatureLimit = 100,
  ) {}

  async scanWallet(address: string): Promise<FundingDiscoveryResult> {
    const target = new PublicKey(address);
    const signatures = await this.rpc.getSignaturesForAddress(target, { limit: this.signatureLimit });
    let discovered = 0;
    let skipped = 0;

    for (const entry of signatures) {
      if (entry.err) { skipped += 1; continue; }
      const tx = await this.rpc.getParsedTransaction(entry.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx?.meta || tx.meta.err) { skipped += 1; continue; }

      const relevant = directSolTransfers(tx).filter((transfer) => transfer.from === address || transfer.to === address);
      if (relevant.length === 0) { skipped += 1; continue; }

      for (const transfer of relevant) {
        const fromWallet = await ensureWallet(this.db, transfer.from);
        const toWallet = await ensureWallet(this.db, transfer.to);
        const relationshipType = 'funded';
        const existing = await this.db.walletRelationship.findFirst({
          where: {
            walletAId: fromWallet.id,
            walletBId: toWallet.id,
            relationshipType,
            observedTxSignature: entry.signature,
          },
        });
        if (existing) continue;

        await this.db.walletRelationship.create({
          data: {
            walletAId: fromWallet.id,
            walletBId: toWallet.id,
            relationshipType,
            evidenceSource: 'BLOCKCHAIN_DERIVED',
            evidenceDescription: `Observed direct System Program transfer of ${transfer.lamports} lamports from ${transfer.from} to ${transfer.to}.`,
            confidenceLevel: 'high',
            observedTxSignature: entry.signature,
          },
        });
        discovered += 1;
      }
    }

    return { scanned: signatures.length, discovered, skipped };
  }
}
