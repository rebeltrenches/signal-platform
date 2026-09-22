import type { SignalTraceEdge, SignalTraceNode, SignalTraceResult } from './SignalTrace.js';

export interface WalletRelationshipCluster {
  id: string;
  members: SignalTraceNode[];
  edges: SignalTraceEdge[];
  directFundingSources: string[];
  summary: {
    memberCount: number;
    transactionEvidenceCount: number;
    deepestObservedDepth: number;
  };
}

export interface WalletRelationshipClustersResult {
  root: string;
  chain: string;
  clusters: WalletRelationshipCluster[];
  summary: {
    clusterCount: number;
    fundingSourceCount: number;
    sharedPathClusterCount: number;
    transactionEvidenceCount: number;
  };
  truncated: boolean;
  evidencePolicy: {
    ownershipInference: false;
    note: string;
  };
}

/**
 * Groups funding-source wallets by observed paths between those sources.
 * The searched root is deliberately removed before connected components are
 * calculated: two unrelated wallets do not become a "cluster" merely because
 * both sent funds to the root. This remains transaction-path evidence only.
 */
export function buildWalletRelationshipClusters(trace: SignalTraceResult): WalletRelationshipClustersResult {
  const sourceNodes = trace.nodes
    .filter((node) => node.role === 'FUNDING_SOURCE')
    .sort((a, b) => a.depth - b.depth || a.address.localeCompare(b.address));
  const sources = new Map(sourceNodes.map((node) => [node.address, node]));
  const adjacency = new Map(sourceNodes.map((node) => [node.address, new Set<string>()]));
  const eligibleEdges = trace.edges.filter((edge) =>
    edge.evidenceSource === 'BLOCKCHAIN_DERIVED' &&
    Boolean(edge.observedTxSignature) &&
    (edge.to === trace.root || sources.has(edge.to)) &&
    sources.has(edge.from)
  );

  for (const edge of eligibleEdges) {
    if (edge.to === trace.root) continue;
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const components: SignalTraceNode[][] = [];
  const visited = new Set<string>();
  for (const node of sourceNodes) {
    if (visited.has(node.address)) continue;
    const stack = [node.address];
    const component: SignalTraceNode[] = [];
    visited.add(node.address);
    while (stack.length > 0) {
      const address = stack.pop()!;
      component.push(sources.get(address)!);
      for (const neighbor of adjacency.get(address) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    component.sort((a, b) => a.depth - b.depth || a.address.localeCompare(b.address));
    components.push(component);
  }

  const clusters = components.map((members, index): WalletRelationshipCluster => {
    const addresses = new Set(members.map((member) => member.address));
    const edges = eligibleEdges.filter((edge) =>
      addresses.has(edge.from) && (edge.to === trace.root || addresses.has(edge.to))
    );
    const signatures = new Set(edges.map((edge) => edge.observedTxSignature));
    const directFundingSources = [...new Set(
      edges.filter((edge) => edge.to === trace.root).map((edge) => edge.from)
    )].sort();

    return {
      id: `relationship-cluster-${index + 1}`,
      members,
      edges,
      directFundingSources,
      summary: {
        memberCount: members.length,
        transactionEvidenceCount: signatures.size,
        deepestObservedDepth: members.reduce((max, member) => Math.max(max, member.depth), 0),
      },
    };
  });
  const allSignatures = new Set(clusters.flatMap((cluster) => cluster.edges.map((edge) => edge.observedTxSignature)));

  return {
    root: trace.root,
    chain: trace.chain,
    clusters,
    summary: {
      clusterCount: clusters.length,
      fundingSourceCount: sourceNodes.length,
      sharedPathClusterCount: clusters.filter((cluster) => cluster.members.length > 1).length,
      transactionEvidenceCount: allSignatures.size,
    },
    truncated: trace.truncated,
    evidencePolicy: {
      ownershipInference: false,
      note: 'Relationship clusters group wallets by observed funding paths only; they do not claim common ownership, identity, coordination, or risk.',
    },
  };
}
