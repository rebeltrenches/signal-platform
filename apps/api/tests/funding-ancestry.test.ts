import assert from 'node:assert/strict';
import { traceFundingAncestry, type FundingAncestryRelationship } from '../src/wallets/FundingAncestry.js';

const rel = (from: string, to: string, sig: string | null, source: any = 'BLOCKCHAIN_DERIVED'): FundingAncestryRelationship => ({
  walletA: { address: from, chain: 'SOLANA' },
  walletB: { address: to, chain: 'SOLANA' },
  relationshipType: 'funded',
  evidenceSource: source,
  observedTxSignature: sig,
});

async function run() {
  const graph: Record<string, FundingAncestryRelationship[]> = {
    Root: [rel('ParentA', 'Root', 'sig-1'), rel('ParentB', 'Root', 'sig-2'), rel('ClaimOnly', 'Root', null, 'COMMUNITY_REPORTED')],
    ParentA: [rel('Grandparent', 'ParentA', 'sig-3')],
    ParentB: [rel('Grandparent', 'ParentB', 'sig-4')],
    Grandparent: [rel('Root', 'Grandparent', 'sig-cycle')],
  };
  const reader = { incomingFunding: async (_chain: string, address: string) => graph[address] ?? [] };

  const result = await traceFundingAncestry(reader, 'SOLANA', 'Root', 3);
  assert.equal(result.root, 'Root');
  assert.equal(result.maxDepth, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.nodes.sort((a,b) => a.address.localeCompare(b.address)), [
    { address:'Grandparent', depth:2 },
    { address:'ParentA', depth:1 },
    { address:'ParentB', depth:1 },
    { address:'Root', depth:0 },
  ]);
  assert.equal(result.edges.length, 5);
  assert.ok(result.edges.every((e) => e.evidenceSource === 'BLOCKCHAIN_DERIVED' && e.observedTxSignature));
  assert.equal(result.edges.some((e) => e.from === 'ClaimOnly'), false);

  const shallow = await traceFundingAncestry(reader, 'SOLANA', 'Root', 1);
  assert.equal(shallow.edges.length, 2);
  assert.equal(shallow.nodes.some((n) => n.address === 'Grandparent'), false);

  const capped = await traceFundingAncestry(reader, 'SOLANA', 'Root', 3, 1);
  assert.equal(capped.edges.length, 1);
  assert.equal(capped.truncated, true);

  console.log('  ok  - traces multi-hop incoming funding evidence');
  console.log('  ok  - ignores unsupported/non-transaction claims');
  console.log('  ok  - bounds traversal depth and edge count');
  console.log('  ok  - cycles do not cause unbounded traversal');
  console.log('\n4 test(s) passed.');
}
run().catch((err) => { console.error(err); process.exit(1); });
