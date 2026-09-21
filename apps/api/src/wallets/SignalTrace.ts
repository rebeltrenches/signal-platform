import type { FundingAncestryResult } from './FundingAncestry.js';
import type { WalletEvidenceSource } from './WalletIntelligenceRepository.js';

export interface SignalTraceNode {
  address: string;
  depth: number;
  role: 'ROOT' | 'FUNDING_SOURCE';
}

export interface SignalTraceEdge {
  from: string;
  to: string;
  depth: number;
  relationshipType: 'funded';
  evidenceSource: WalletEvidenceSource;
  observedTxSignature: string;
}

export interface SignalTraceResult {
  root: string;
  chain: string;
  maxDepth: number;
  nodes: SignalTraceNode[];
  edges: SignalTraceEdge[];
  summary: {
    fundingSourceCount: number;
    transactionEvidenceCount: number;
    deepestObservedDepth: number;
  };
  truncated: boolean;
  evidencePolicy: {
    ownershipInference: false;
    note: string;
  };
}

/**
 * Converts verified funding ancestry into the neutral graph contract consumed
 * by Signal Trace and, later, the Bubble Map. It adds no ownership, identity,
 * scam, or risk inference.
 */
export function buildSignalTrace(chain: string, ancestry: FundingAncestryResult): SignalTraceResult {
  const signatures = new Set(ancestry.edges.map((edge) => edge.observedTxSignature));
  const deepestObservedDepth = ancestry.nodes.reduce((max, node) => Math.max(max, node.depth), 0);

  return {
    root: ancestry.root,
    chain,
    maxDepth: ancestry.maxDepth,
    nodes: ancestry.nodes.map((node) => ({
      address: node.address,
      depth: node.depth,
      role: node.address === ancestry.root ? 'ROOT' : 'FUNDING_SOURCE',
    })),
    edges: ancestry.edges.map((edge) => ({
      ...edge,
      relationshipType: 'funded' as const,
    })),
    summary: {
      fundingSourceCount: ancestry.nodes.filter((node) => node.address !== ancestry.root).length,
      transactionEvidenceCount: signatures.size,
      deepestObservedDepth,
    },
    truncated: ancestry.truncated,
    evidencePolicy: {
      ownershipInference: false,
      note: 'Signal Trace shows observed transaction paths only; it does not claim common ownership or identity.',
    },
  };
}
