import React from 'react';
import { EmptyState } from '../components/EmptyState.js';

const TABS = [
  { id: 'new', label: 'New' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'graduating', label: 'Graduating' },
];

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  new: { title: 'Waiting for live launches', body: 'New Signal and external launches will appear here as the market feeds update.' },
  momentum: { title: 'No momentum matches', body: 'No token with reported trading volume currently matches these filters.' },
  graduating: { title: 'No live bonding curves', body: 'New Pump.fun bonding-curve launches will appear here in real time.' },
};

export function ExplorePage() {
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <div>
          <h1>Explore</h1>
          <p>Launch Radar — new, trending, and graduating tokens across every supported chain.</p>
        </div>
      </div>

      <p id="explore-live-status" className="hint" aria-live="polite">Connecting live market feeds…</p>

      <div className="toolbar">
        <input className="input" id="exploreSearchInput" placeholder="Search name, symbol, or address" aria-label="Search tokens" />
        <button className="chip" data-filter-chain="solana" aria-pressed="false">Solana</button>
        <button className="chip" data-filter-chain="base" aria-pressed="false">Base</button>
        <button className="chip" data-filter-chain="bnb" aria-pressed="false">BNB Chain</button>
      </div>

      <div className="toolbar" style={{ marginTop: -8 }}>
        <span className="hint" style={{ textTransform: 'none' }}>Origin:</span>
        <button className="chip" data-origin="all" aria-pressed="true">All tokens</button>
        <button className="chip" data-origin="signal" aria-pressed="false">Launched on Signal</button>
        <button className="chip" data-origin="external" aria-pressed="false">External (e.g. Pump.fun)</button>
      </div>

      <div className="toolbar" style={{ marginTop: -8 }}>
        <span className="hint" style={{ textTransform: 'none' }}>Sort:</span>
        <button className="chip" data-sort="newest" aria-pressed="true">Newest</button>
        <button className="chip" data-sort="volume" aria-pressed="false">Volume</button>
      </div>

      <div className="tabbar" id="explore-tabs" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={i === 0 ? 'true' : 'false'} data-tab={t.id} type="button">
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 24 }} id="explore-panels">
        {TABS.map((t, i) => (
          <div key={t.id} data-panel={t.id} hidden={i !== 0}>
            <div id={`explore-${t.id}-list`}></div>
            <div id={`explore-${t.id}-empty`}>
              <EmptyState title={EMPTY_COPY[t.id]!.title} body={EMPTY_COPY[t.id]!.body} />
            </div>
          </div>
        ))}
      </div>

      <div className="how-box" style={{ marginTop: 24 }}>
        Once real tokens are indexed, each card shows a status badge sourced from real data —
        never a "safe" score. See the <a href="/transparency" style={{ color: 'var(--brand)' }}>Transparency Center</a> for
        what each evidence label means.
      </div>
    </div>
  );
}
