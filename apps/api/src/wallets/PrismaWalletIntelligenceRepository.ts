import type { WalletIntelligenceRecord, WalletIntelligenceRepository } from './WalletIntelligenceRepository.js';

export interface WalletIntelligencePrismaLikeClient {
  wallet: { findUnique(args: any): Promise<any> };
  holder: { findMany(args: any): Promise<any[]> };
  walletActivity: { findFirst(args: any): Promise<any> };
  walletRelationship: { findMany(args: any): Promise<any[]> };
}

const iso = (value: any): string => value instanceof Date ? value.toISOString() : String(value);

export class PrismaWalletIntelligenceRepository implements WalletIntelligenceRepository {
  constructor(private readonly db: WalletIntelligencePrismaLikeClient) {}

  async incomingFunding(chain: string, address: string) {
    return this.db.walletRelationship.findMany({
      where: {
        relationshipType: 'funded',
        evidenceSource: 'BLOCKCHAIN_DERIVED',
        observedTxSignature: { not: null },
        walletB: { address, chain },
        walletA: { chain },
      },
      include: { walletA: true, walletB: true },
      orderBy: { discoveredAt: 'desc' },
      take: 250,
    });
  }

  async getWallet(chain: string, address: string): Promise<WalletIntelligenceRecord | null> {
    const wallet = await this.db.wallet.findUnique({
      where: { address_chain: { address, chain } },
      include: {
        createdTokens: { orderBy: { createdAt: 'desc' } },
        activity: { orderBy: { occurredAt: 'desc' }, take: 100 },
        relationshipsAsA: { include: { walletB: true }, orderBy: { discoveredAt: 'desc' }, take: 100 },
        relationshipsAsB: { include: { walletA: true }, orderBy: { discoveredAt: 'desc' }, take: 100 },
        notes: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!wallet) return null;

    // Holder snapshots deliberately match by chain + address. Holder has
    // no Wallet FK in the schema, so joining through Wallet would invent
    // a relationship that does not exist.
    const firstActivity = await this.db.walletActivity.findFirst({
      where: { walletId: wallet.id },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });

    const holdings = await this.db.holder.findMany({
      where: { address, token: { chain } },
      include: { token: true },
      orderBy: { balance: 'desc' },
      take: 100,
    });

    const activities = wallet.activity ?? [];

    const mapRelationship = (row: any, direction: 'outgoing' | 'incoming', other: any) => ({
      id: row.id,
      direction,
      relatedWallet: { address: other.address, chain: other.chain },
      relationshipType: row.relationshipType,
      evidenceSource: row.evidenceSource,
      evidenceDescription: row.evidenceDescription,
      confidenceLevel: row.confidenceLevel,
      observedTxSignature: row.observedTxSignature ?? null,
      discoveredAt: iso(row.discoveredAt),
    });

    const relationships = [
      ...(wallet.relationshipsAsA ?? []).map((r: any) => mapRelationship(r, 'outgoing', r.walletB)),
      ...(wallet.relationshipsAsB ?? []).map((r: any) => mapRelationship(r, 'incoming', r.walletA)),
    ].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
    const uniqueRelatedWallets = new Set(relationships.map((r) => `${r.relatedWallet.chain}:${r.relatedWallet.address}`));
    const transactionEvidence = new Set(relationships.flatMap((r) => r.observedTxSignature ? [r.observedTxSignature] : []));

    return {
      address: wallet.address,
      chain: wallet.chain,
      firstObservedActivity: firstActivity?.occurredAt ? iso(firstActivity.occurredAt) : null,
      holdings: holdings.map((h: any) => ({
        token: {
          id: h.token.id, chain: h.token.chain, address: h.token.address,
          name: h.token.name, symbol: h.token.symbol, decimals: h.token.decimals,
        },
        balance: String(h.balance),
        lastUpdated: iso(h.lastUpdated),
      })),
      activities: activities.map((a: any) => ({
        id: a.id, kind: a.kind, tokenId: a.tokenId ?? null,
        usdValue: a.usdValue == null ? null : String(a.usdValue),
        occurredAt: iso(a.occurredAt),
      })),
      createdTokens: (wallet.createdTokens ?? []).map((t: any) => ({
        id: t.id, chain: t.chain, address: t.address, name: t.name,
        symbol: t.symbol, decimals: t.decimals, createdAt: iso(t.createdAt),
      })),
      relationships,
      relationshipSummary: {
        directRelationshipCount: relationships.length,
        incomingCount: relationships.filter((r) => r.direction === 'incoming').length,
        outgoingCount: relationships.filter((r) => r.direction === 'outgoing').length,
        blockchainDerivedCount: relationships.filter((r) => r.evidenceSource === 'BLOCKCHAIN_DERIVED').length,
        uniqueRelatedWalletCount: uniqueRelatedWallets.size,
        transactionEvidenceCount: transactionEvidence.size,
      },
      notes: (wallet.notes ?? []).map((n: any) => ({
        id: n.id, note: n.note, evidenceSource: n.evidenceSource,
        evidenceTxSignature: n.evidenceTxSignature ?? null, createdAt: iso(n.createdAt),
      })),
    };
  }
}
