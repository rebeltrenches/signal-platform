import type { SignalTraceResult } from './SignalTrace.js';

export interface WalletHistoryReplayEvent {
  sequence: number;
  depth: number;
  from: string;
  to: string;
  relationshipType: 'funded';
  evidenceSource: 'BLOCKCHAIN_DERIVED';
  observedTxSignature: string;
}

export interface WalletHistoryReplay {
  root: string;
  chain: string;
  events: WalletHistoryReplayEvent[];
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
  const events = trace.edges
    .map((edge, index) => ({
      sequence: index + 1,
      depth: edge.depth,
      from: edge.from,
      to: edge.to,
      relationshipType: edge.relationshipType,
      evidenceSource: edge.evidenceSource,
      observedTxSignature: edge.observedTxSignature,
    }))
    .sort((a, b) => a.depth - b.depth || a.sequence - b.sequence);

  return {
    root: trace.root,
    chain: trace.chain,
    events,
    truncated: trace.truncated,
    evidencePolicy: {
      ownershipInference: false,
      note: 'Wallet History Replay shows observed transaction evidence only. Sequence reflects the current trace result, not transaction time, until verified block timestamps are indexed.',
    },
  };
}
