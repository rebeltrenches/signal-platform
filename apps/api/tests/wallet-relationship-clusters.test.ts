import assert from 'node:assert/strict';
import { buildWalletRelationshipClusters } from '../src/wallets/WalletRelationshipClusters.js';
import type { SignalTraceResult } from '../src/wallets/SignalTrace.js';

function run() {
  const trace: SignalTraceResult = {
    root: 'Root',
    chain: 'SOLANA',
    maxDepth: 3,
    nodes: [
      { address: 'Root', depth: 0, role: 'ROOT' },
      { address: 'ParentA', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'ParentB', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'SoloParent', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'SharedUpstream', depth: 2, role: 'FUNDING_SOURCE' },
    ],
    edges: [
      { from: 'ParentA', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-a' },
      { from: 'ParentB', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-b' },
      { from: 'SoloParent', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-solo' },
      { from: 'SharedUpstream', to: 'ParentA', depth: 2, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-shared' },
      { from: 'SharedUpstream', to: 'ParentB', depth: 2, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-shared' },
    ],
    summary: { fundingSourceCount: 4, transactionEvidenceCount: 4, deepestObservedDepth: 2 },
    truncated: false,
    evidencePolicy: { ownershipInference: false, note: 'Observed paths only.' },
  };

  const result = buildWalletRelationshipClusters(trace);
  assert.deepEqual(result.summary, {
    clusterCount: 2,
    fundingSourceCount: 4,
    sharedPathClusterCount: 1,
    transactionEvidenceCount: 4,
  });
  const sharedCluster = result.clusters[0];
  const soloCluster = result.clusters[1];
  assert.ok(sharedCluster);
  assert.ok(soloCluster);
  assert.deepEqual(sharedCluster.members.map((member) => member.address), ['ParentA', 'ParentB', 'SharedUpstream']);
  assert.deepEqual(sharedCluster.directFundingSources, ['ParentA', 'ParentB']);
  assert.equal(sharedCluster.summary.transactionEvidenceCount, 3);
  assert.deepEqual(soloCluster.members.map((member) => member.address), ['SoloParent']);
  assert.deepEqual(soloCluster.directFundingSources, ['SoloParent']);
  assert.equal(result.evidencePolicy.ownershipInference, false);
  assert.match(result.evidencePolicy.note, /do not claim common ownership/i);

  const empty = buildWalletRelationshipClusters({
    ...trace,
    nodes: [{ address: 'Root', depth: 0, role: 'ROOT' }],
    edges: [],
    summary: { fundingSourceCount: 0, transactionEvidenceCount: 0, deepestObservedDepth: 0 },
  });
  assert.deepEqual(empty.clusters, []);
  assert.equal(empty.summary.clusterCount, 0);

  console.log('  ok  - groups only sources connected by observed upstream paths');
  console.log('  ok  - keeps unrelated direct funders in separate groups');
  console.log('  ok  - deduplicates transaction evidence');
  console.log('  ok  - preserves neutral evidence policy and empty results');
  console.log('\n4 test(s) passed.');
}

run();
