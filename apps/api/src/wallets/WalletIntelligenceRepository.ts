export type WalletEvidenceSource =
  | 'BLOCKCHAIN_DERIVED'
  | 'SIGNAL_VERIFIED'
  | 'CREATOR_PROVIDED'
  | 'THIRD_PARTY'
  | 'COMMUNITY_REPORTED';

export interface WalletHoldingRecord {
  token: { id: string; chain: string; address: string; name: string; symbol: string; decimals: number };
  balance: string;
  lastUpdated: string;
}

export interface WalletActivityRecord {
  id: string;
  kind: string;
  tokenId: string | null;
  usdValue: string | null;
  occurredAt: string;
}

export interface WalletRelationshipRecord {
  id: string;
  direction: 'outgoing' | 'incoming';
  relatedWallet: { address: string; chain: string };
  relationshipType: string;
  evidenceSource: WalletEvidenceSource;
  evidenceDescription: string;
  confidenceLevel: string;
  observedTxSignature: string | null;
  discoveredAt: string;
}

export interface WalletRelationshipSummary {
  directRelationshipCount: number;
  incomingCount: number;
  outgoingCount: number;
  blockchainDerivedCount: number;
  uniqueRelatedWalletCount: number;
  transactionEvidenceCount: number;
}

export interface WalletNoteRecord {
  id: string;
  note: string;
  evidenceSource: WalletEvidenceSource;
  evidenceTxSignature: string | null;
  createdAt: string;
}

export interface WalletIntelligenceRecord {
  address: string;
  chain: string;
  firstObservedActivity: string | null;
  holdings: WalletHoldingRecord[];
  activities: WalletActivityRecord[];
  createdTokens: Array<{ id: string; chain: string; address: string; name: string; symbol: string; decimals: number; createdAt: string }>;
  relationships: WalletRelationshipRecord[];
  relationshipSummary: WalletRelationshipSummary;
  notes: WalletNoteRecord[];
}

export interface WalletIntelligenceRepository {
  getWallet(chain: string, address: string): Promise<WalletIntelligenceRecord | null>;
}
