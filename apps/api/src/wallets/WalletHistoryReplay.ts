import type { SignalTraceResult } from './SignalTrace.js';

export interface WalletHistoryReplayEvent {
  sequence: number;
  depth: number;
  from: string;
  to: string;
  relationshipType: 'funded';
  evidenceSource: 'BLOCKCHAIN_DERIVED';
  observedTxSignature: string;
  observedAt: string | null;
}

export interface WalletHistoryReplay {
  root: string;
  chain: string;
  events: WalletHistoryReplayEvent[];
  ordering: 'VERIFIED_BLOCK_TIME' | 'TRACE_SEQUENCE';
  truncated: boolean;
  evidencePolicy: {
    ownershipInference: false;
    note: string;
  };
}

/**
 * Evidence replay foundation. Until indexed block time is carried by
 * relationship evidence, this deliberately exposes trace sequence/depth
 * rather than inventing dates or transaction chronology.
 */
export function buildWalletHistoryReplay(trace: SignalTraceResult): WalletHistoryReplay {
  const blockchainEdges = trace.edges.filter((edge) => edge.evidenceSource === 'BLOCKCHAIN_DERIVED');
  const hasCompleteBlockTime = blockchainEdges.length > 0 && blockchainEdges.every((edge) => Boolean(edge.observedAt));
  const events = trace.edges
    .filter((edge) => edge.evidenceSource === 'BLOCKCHAIN_DERIVED')
    .map((edge, index) => ({ edge, originalIndex: index }))
    .sort((a, b) => hasCompleteBlockTime
      ? String(a.edge.observedAt).localeCompare(String(b.edge.observedAt)) || a.originalIndex - b.originalIndex
      : a.edge.depth - b.edge.depth || a.originalIndex - b.originalIndex)
    .map(({ edge }, index) => ({
      sequence: index + 1,
      depth: edge.depth,
      from: edge.from,
      to: edge.to,
      relationshipType: edge.relationshipType,
      evidenceSource: 'BLOCKCHAIN_DERIVED' as const,
      observedTxSignature: edge.observedTxSignature,
      observedAt: edge.observedAt ?? null,
    }));

  return {
    root: trace.root,
    chain: trace.chain,
    events,
    ordering: hasCompleteBlockTime ? 'VERIFIED_BLOCK_TIME' : 'TRACE_SEQUENCE',
    truncated: trace.truncated,
    evidencePolicy: {
      ownershipInference: false,
      note: hasCompleteBlockTime
        ? 'Wallet History Replay is ordered by verified on-chain block time. It shows transaction evidence only and does not claim common ownership or identity.'
        : 'Wallet History Replay shows observed transaction evidence only. Sequence reflects the current trace result, not transaction time, until every edge has a verified block timestamp.',
    },
  };
}
