import assert from 'node:assert/strict';
import { buildWalletProjectHistory } from '../src/wallets/WalletProjectHistory.js';
import type { SignalTraceResult } from '../src/wallets/SignalTrace.js';

function run() {
  const trace: SignalTraceResult = {
    root: 'Root', chain: 'SOLANA', maxDepth: 3,
    nodes: [
      { address: 'Root', depth: 0, role: 'ROOT' },
      { address: 'Parent', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'Upstream', depth: 2, role: 'FUNDING_SOURCE' },
    ],
    edges: [
      { from: 'Parent', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-parent' },
      { from: 'Upstream', to: 'Parent', depth: 2, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-upstream' },
    ],
    summary: { fundingSourceCount: 2, transactionEvidenceCount: 2, deepestObservedDepth: 2 },
    truncated: false,
    evidencePolicy: { ownershipInference: false, note: 'Observed paths only.' },
  };
  const result = buildWalletProjectHistory(trace, [
    { id: 'direct', chain: 'SOLANA', address: 'MintDirect', name: 'Direct', symbol: 'DIR', createdAt: '2026-03-01T00:00:00.000Z', creatorWalletAddress: 'Root', launchStatus: 'GRADUATED' },
    { id: 'upstream', chain: 'SOLANA', address: 'MintUpstream', name: 'Upstream project', symbol: 'UP', createdAt: '2026-02-01T00:00:00.000Z', creatorWalletAddress: 'Upstream', launchStatus: 'FAILED' },
    { id: 'unrelated', chain: 'SOLANA', address: 'MintOther', name: 'Other', symbol: 'OTH', createdAt: '2026-01-01T00:00:00.000Z', creatorWalletAddress: 'OtherWallet', launchStatus: null },
    { id: 'wrong-chain', chain: 'BASE', address: 'BaseMint', name: 'Base', symbol: 'BASE', createdAt: '2026-01-01T00:00:00.000Z', creatorWalletAddress: 'Root', launchStatus: null },
  ]);

  assert.equal(result.projects.length, 2);
  const direct = result.projects.find((project) => project.project.id === 'direct');
  const upstream = result.projects.find((project) => project.project.id === 'upstream');
  assert.ok(direct);
  assert.ok(upstream);
  assert.equal(direct.associationType, 'ROOT_CREATOR_RECORD');
  assert.deepEqual(direct.fundingPath, []);
  assert.equal(upstream.associationType, 'OBSERVED_FUNDING_PATH');
  assert.deepEqual(upstream.observedTxSignatures, ['sig-upstream', 'sig-parent']);
  assert.equal(upstream.project.launchStatus, 'FAILED');
  assert.equal(upstream.creatorEvidenceSource, 'CREATOR_PROVIDED');
  assert.deepEqual(result.summary, {
    directProjectCount: 1,
    observedPathProjectCount: 1,
    uniqueCreatorWalletCount: 2,
    transactionEvidenceCount: 2,
  });
  assert.equal(result.evidencePolicy.ownershipInference, false);
  assert.equal(result.evidencePolicy.projectOutcomeInference, false);
  assert.match(result.evidencePolicy.note, /creator-provided indexed records/i);

  console.log('  ok  - joins direct creator records and observed funding paths');
  console.log('  ok  - preserves transaction signatures across multi-hop paths');
  console.log('  ok  - excludes unrelated wallets and chains');
  console.log('  ok  - exposes stored status without ownership or outcome inference');
  console.log('\n4 test(s) passed.');
}

run();
