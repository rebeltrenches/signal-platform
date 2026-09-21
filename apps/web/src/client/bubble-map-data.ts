export interface BubbleMapNode {
  id: string;
  address: string;
  depth: number;
  role: 'ROOT' | 'FUNDING_SOURCE';
  label: string;
}

export interface BubbleMapEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: 'funded';
  evidenceSource: 'BLOCKCHAIN_DERIVED';
  observedTxSignature: string;
}

export interface BubbleMapData {
  root: string;
  chain: string;
  nodes: BubbleMapNode[];
  edges: BubbleMapEdge[];
  truncated: boolean;
}

interface SignalTraceLike {
  root: string;
  chain: string;
  nodes: Array<{ address: string; depth: number; role: 'ROOT' | 'FUNDING_SOURCE' }>;
  edges: Array<{
    from: string;
    to: string;
    relationshipType: 'funded';
    evidenceSource: 'BLOCKCHAIN_DERIVED';
    observedTxSignature: string;
  }>;
  truncated: boolean;
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Presentation-only adapter for the future interactive Bubble Map.
 * Bubble size/holdings are deliberately absent until reliable holder data
 * exists. Every edge retains its transaction evidence.
 */
export function buildBubbleMapData(trace: SignalTraceLike): BubbleMapData {
  return {
    root: trace.root,
    chain: trace.chain,
    nodes: trace.nodes.map((node) => ({
      id: node.address,
      address: node.address,
      depth: node.depth,
      role: node.role,
      label: shortAddress(node.address),
    })),
    edges: trace.edges.map((edge) => ({
      id: `${edge.observedTxSignature}:${edge.from}:${edge.to}`,
      source: edge.from,
      target: edge.to,
      relationshipType: edge.relationshipType,
      evidenceSource: edge.evidenceSource,
      observedTxSignature: edge.observedTxSignature,
    })),
    truncated: trace.truncated,
  };
}
