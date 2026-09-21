import type { WalletEvidenceSource } from './WalletIntelligenceRepository.js';

export interface FundingAncestryEdge {
  from: string;
  to: string;
  depth: number;
  evidenceSource: WalletEvidenceSource;
  observedTxSignature: string;
}

export interface FundingAncestryNode {
  address: string;
  depth: number;
}

export interface FundingAncestryResult {
  root: string;
  maxDepth: number;
  nodes: FundingAncestryNode[];
  edges: FundingAncestryEdge[];
  truncated: boolean;
}

export interface FundingAncestryRelationship {
  walletA: { address: string; chain: string };
  walletB: { address: string; chain: string };
  relationshipType: string;
  evidenceSource: WalletEvidenceSource;
  observedTxSignature: string | null;
}

export interface FundingAncestryReader {
  incomingFunding(chain: string, address: string): Promise<FundingAncestryRelationship[]>;
}

/**
 * Traces observed incoming funding paths only. A path is transaction evidence
 * between wallets; it is never evidence that wallets share an owner or identity.
 */
export async function traceFundingAncestry(
  reader: FundingAncestryReader,
  chain: string,
  root: string,
  maxDepth = 3,
  maxEdges = 250,
): Promise<FundingAncestryResult> {
  const safeDepth = Math.max(0, Math.min(maxDepth, 6));
  const nodes = new Map<string, number>([[root, 0]]);
  const edges: FundingAncestryEdge[] = [];
  const seenEdges = new Set<string>();
  let frontier = [root];
  let truncated = false;

  for (let depth = 1; depth <= safeDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const address of frontier) {
      const rows = await reader.incomingFunding(chain, address);
      for (const row of rows) {
        if (
          row.relationshipType !== 'funded' ||
          row.evidenceSource !== 'BLOCKCHAIN_DERIVED' ||
          !row.observedTxSignature ||
          row.walletB.address !== address ||
          row.walletA.chain !== chain ||
          row.walletB.chain !== chain
        ) continue;

        const key = `${row.observedTxSignature}:${row.walletA.address}:${row.walletB.address}`;
        if (seenEdges.has(key)) continue;
        if (edges.length >= maxEdges) { truncated = true; break; }
        seenEdges.add(key);
        edges.push({
          from: row.walletA.address,
          to: row.walletB.address,
          depth,
          evidenceSource: row.evidenceSource,
          observedTxSignature: row.observedTxSignature,
        });

        if (!nodes.has(row.walletA.address)) {
          nodes.set(row.walletA.address, depth);
          next.push(row.walletA.address);
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
    frontier = next;
  }

  return {
    root,
    maxDepth: safeDepth,
    nodes: [...nodes].map(([address, depth]) => ({ address, depth })),
    edges,
    truncated,
  };
}
