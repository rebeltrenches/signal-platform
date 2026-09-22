import assert from 'node:assert/strict';
import { buildBubbleMapData } from '../src/client/bubble-map-data.js';

function run() {
  const map = buildBubbleMapData({
    root: 'RootWallet1234567890',
    chain: 'SOLANA',
    nodes: [
      { address: 'RootWallet1234567890', depth: 0, role: 'ROOT' },
      { address: 'FundingWalletABCDEFGHIJ', depth: 1, role: 'FUNDING_SOURCE' },
    ],
    edges: [{
      from: 'FundingWalletABCDEFGHIJ',
      to: 'RootWallet1234567890',
      relationshipType: 'funded',
      evidenceSource: 'BLOCKCHAIN_DERIVED',
      observedTxSignature: 'sig-1',
    }],
    truncated: false,
  }, { clusters: [{ id: 'relationship-cluster-1', members: [{ address: 'FundingWalletABCDEFGHIJ' }] }] });

  assert.equal(map.root, 'RootWallet1234567890');
  assert.equal(map.chain, 'SOLANA');
  assert.equal(map.nodes.length, 2);
  assert.deepEqual(map.nodes[0], {
    id: 'RootWallet1234567890',
    address: 'RootWallet1234567890',
    depth: 0,
    role: 'ROOT',
    label: 'RootWa…7890',
    relationshipClusterId: null,
  });
  assert.equal(map.nodes[1]?.relationshipClusterId, 'relationship-cluster-1');
  assert.equal(map.edges.length, 1);
  assert.deepEqual(map.edges[0], {
    id: 'sig-1:FundingWalletABCDEFGHIJ:RootWallet1234567890',
    source: 'FundingWalletABCDEFGHIJ',
    target: 'RootWallet1234567890',
    relationshipType: 'funded',
    evidenceSource: 'BLOCKCHAIN_DERIVED',
    observedTxSignature: 'sig-1',
  });
  assert.equal(map.truncated, false);

  const short = buildBubbleMapData({
    root: 'Short',
    chain: 'SOLANA',
    nodes: [{ address: 'Short', depth: 0, role: 'ROOT' }],
    edges: [],
    truncated: true,
  });
  assert.equal(short.nodes[0]!.label, 'Short');
  assert.equal(short.truncated, true);

  assert.equal('size' in map.nodes[0]!, false);
  assert.equal('holdings' in map.nodes[0]!, false);

  console.log('  ok  - converts Signal Trace nodes to graph-ready bubbles');
  console.log('  ok  - preserves transaction evidence on every edge');
  console.log('  ok  - preserves truncation state and readable labels');
  console.log('  ok  - carries evidence-backed relationship group labels');
  console.log('  ok  - does not invent holdings or bubble sizes');
  console.log('\n5 test(s) passed.');
}

run();
