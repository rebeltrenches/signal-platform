import type { SignalTraceEdge, SignalTraceResult } from './SignalTrace.js';

export interface IndexedWalletProjectRecord {
  id: string;
  chain: string;
  address: string;
  name: string;
  symbol: string;
  createdAt: string;
  creatorWalletAddress: string;
  launchStatus: string | null;
}

export interface WalletProjectAssociation {
  project: Omit<IndexedWalletProjectRecord, 'creatorWalletAddress'>;
  creatorWalletAddress: string;
  associationType: 'ROOT_CREATOR_RECORD' | 'OBSERVED_FUNDING_PATH';
  creatorEvidenceSource: 'CREATOR_PROVIDED';
  fundingPath: SignalTraceEdge[];
  observedTxSignatures: string[];
}

export interface WalletProjectHistoryResult {
  root: string;
  chain: string;
  projects: WalletProjectAssociation[];
  summary: {
    directProjectCount: number;
    observedPathProjectCount: number;
    uniqueCreatorWalletCount: number;
    transactionEvidenceCount: number;
  };
  truncated: boolean;
  evidencePolicy: {
    ownershipInference: false;
    projectOutcomeInference: false;
    note: string;
  };
}

function fundingPathToRoot(trace: SignalTraceResult, start: string): SignalTraceEdge[] | null {
  if (start === trace.root) return [];
  const edges = trace.edges.filter((edge) =>
    edge.evidenceSource === 'BLOCKCHAIN_DERIVED' && Boolean(edge.observedTxSignature)
  );
  const queue: Array<{ address: string; path: SignalTraceEdge[] }> = [{ address: start, path: [] }];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges.filter((candidate) => candidate.from === current.address)) {
      const path = [...current.path, edge];
      if (edge.to === trace.root) return path;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push({ address: edge.to, path });
    }
  }
  return null;
}

/**
 * Joins indexed creator declarations to observed funding paths. Creator
 * declarations remain CREATOR_PROVIDED; only path edges are described as
 * BLOCKCHAIN_DERIVED. A stored FAILED status is exposed verbatim and never
 * converted into a scam, intent, identity, or ownership conclusion.
 */
export function buildWalletProjectHistory(
  trace: SignalTraceResult,
  indexedProjects: IndexedWalletProjectRecord[],
): WalletProjectHistoryResult {
  const traceAddresses = new Set(trace.nodes.map((node) => node.address));
  const projects = indexedProjects
    .filter((project) => project.chain === trace.chain && traceAddresses.has(project.creatorWalletAddress))
    .map((project): WalletProjectAssociation | null => {
      const fundingPath = fundingPathToRoot(trace, project.creatorWalletAddress);
      if (fundingPath === null) return null;
      const { creatorWalletAddress, ...projectRecord } = project;
      return {
        project: projectRecord,
        creatorWalletAddress,
        associationType: creatorWalletAddress === trace.root ? 'ROOT_CREATOR_RECORD' : 'OBSERVED_FUNDING_PATH',
        creatorEvidenceSource: 'CREATOR_PROVIDED',
        fundingPath,
        observedTxSignatures: [...new Set(fundingPath.map((edge) => edge.observedTxSignature))],
      };
    })
    .filter((project): project is WalletProjectAssociation => project !== null)
    .sort((a, b) => b.project.createdAt.localeCompare(a.project.createdAt) || a.project.address.localeCompare(b.project.address));
  const signatures = new Set(projects.flatMap((project) => project.observedTxSignatures));

  return {
    root: trace.root,
    chain: trace.chain,
    projects,
    summary: {
      directProjectCount: projects.filter((project) => project.associationType === 'ROOT_CREATOR_RECORD').length,
      observedPathProjectCount: projects.filter((project) => project.associationType === 'OBSERVED_FUNDING_PATH').length,
      uniqueCreatorWalletCount: new Set(projects.map((project) => project.creatorWalletAddress)).size,
      transactionEvidenceCount: signatures.size,
    },
    truncated: trace.truncated,
    evidencePolicy: {
      ownershipInference: false,
      projectOutcomeInference: false,
      note: 'Project creator links are creator-provided indexed records. Funding paths are blockchain-derived transaction evidence. Neither establishes common ownership, identity, intent, coordination, or an unrecorded project outcome.',
    },
  };
}
