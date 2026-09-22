import React from 'react';

export interface BubbleMapViewNode {
  id: string;
  address: string;
  depth: number;
  role: 'ROOT' | 'FUNDING_SOURCE';
  label: string;
}

export interface BubbleMapViewEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: 'funded';
  evidenceSource: 'BLOCKCHAIN_DERIVED';
  observedTxSignature: string;
}

export interface BubbleMapViewData {
  root: string;
  chain: string;
  nodes: BubbleMapViewNode[];
  edges: BubbleMapViewEdge[];
  truncated: boolean;
}

function position(node: BubbleMapViewNode, index: number, total: number) {
  if (node.role === 'ROOT') return { x: 50, y: 50 };
  const ring = Math.max(1, node.depth);
  const radius = Math.min(38, 17 + (ring - 1) * 10);
  const angle = ((index / Math.max(1, total)) * Math.PI * 2) - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

export function BubbleMap({ data }: { data: BubbleMapViewData }) {
  const sources = data.nodes.filter((node) => node.role !== 'ROOT');
  const positions = new Map<string, { x: number; y: number }>();
  data.nodes.forEach((node) => {
    const index = node.role === 'ROOT' ? 0 : sources.findIndex((item) => item.id === node.id);
    positions.set(node.id, position(node, index, sources.length));
  });

  return (
    <div className="card" aria-label="Signal Bubble Map">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, font: 'var(--text-h2)', fontSize: '1rem' }}>Signal Bubble Map</h3>
          <p style={{ margin: '5px 0 0', fontSize: '.82rem', opacity: .72 }}>Observed funding relationships · {data.chain}</p>
        </div>
        <span className="badge">{data.nodes.length} wallets</span>
      </div>
      <div style={{ position: 'relative', minHeight: 360, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 16 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {data.edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;
            return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" style={{ stroke: 'currentColor', opacity: .22, strokeWidth: 1.25 }} />;
          })}
        </svg>
        {data.nodes.map((node) => {
          const p = positions.get(node.id)!;
          return (
            <button
              key={node.id}
              type="button"
              className="btn btn-ghost"
              title={node.address}
              data-wallet-address={node.address}
              style={{
                position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)',
                width: node.role === 'ROOT' ? 88 : 72, height: node.role === 'ROOT' ? 88 : 72,
                borderRadius: '50%', padding: 6, fontFamily: 'monospace', fontSize: '.68rem', zIndex: 1,
              }}
            >
              {node.label}
            </button>
          );
        })}
      </div>
      <div className="how-box" style={{ marginTop: 12 }}>
        Each line represents an observed blockchain transaction path. Bubble size does not represent holdings yet.
        {data.truncated ? ' This trace was truncated at its evidence limit.' : ''}
      </div>
    </div>
  );
}
