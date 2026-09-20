import React from 'react';
import type { DataPoint } from '@launchpad/types';
import { sourcedUnavailable } from '@launchpad/types';
import { DataValue } from '../components/DataUnavailable.js';
import { SourcedRow, SourceTag } from '../components/SourcedValue.js';
import { ChatRoom } from '../components/ChatRoom.js';

const TABS = ['Overview', 'Chart', 'Trades', 'Holders', 'Signal Check', 'Signal Trace', 'Creator', 'Transactions', 'Community'];

const unavailable: DataPoint<never> = { status: 'unavailable' };

/**
 * This is the LAYOUT TEMPLATE for /token/[chain]/[address] — master spec
 * sections 9 (fields), 11 (evidence-sourced verification), 12 ("Signal
 * Check — Know Before You Buy"). A static build can't do real dynamic
 * routing per arbitrary token address (needs a real server, Stage 3+11
 * wired together); this file shows the full intended structure and real
 * tab-switching behavior at one example path, with every fact rendered
 * through DataValue/SourcedRow so it's honestly "Unavailable" — never a
 * placeholder that could be mistaken for real data — and every fact that
 * IS available is labeled with where it actually came from.
 */
export function TokenDetailPage() {
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="badge badge-placeholder" style={{ marginTop: 24 }}>
        Layout template — real per-token data needs Stage 11 (indexer)
      </div>

      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }} />
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DataValue point={unavailable} format={() => ''} />
              <span className="badge">Solana</span>
              <span className="badge badge-placeholder" id="signal-launch-badge" title="Whether this token was created through Signal, or discovered from elsewhere — master spec section 23">
                Launched on Signal: Unavailable
              </span>
            </h1>
            <p style={{ fontFamily: 'monospace', fontSize: 12 }}>Contract address unavailable — no token indexed at this path yet</p>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Price</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Market cap</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Liquidity</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Holders</div></div>
      </div>

      {/* Real Trade terminal shape — master spec section 11/23. Every
          field a real pre-trade review needs is here, honestly
          unavailable, because no DexAdapter implementation (Raydium/
          Orca) exists yet — Stage 10. The Buy/Sell button is inert by
          construction (no data-action, no listener) — same pattern as
          the Create flow's Launch button before Stage 6 was approved.
          Trading here will be REAL when built, or not built at all —
          never a fake fill. */}
      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="chip" aria-pressed="true" disabled>Buy</button>
          <button className="chip" aria-pressed="false" disabled>Sell</button>
        </div>
        <input className="input" placeholder="Amount" disabled style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['25%', '50%', '75%', '100%'].map((p) => (
            <button key={p} className="chip" disabled>{p}</button>
          ))}
        </div>
        <div className="review-row"><span className="k">Route</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Liquidity source</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Expected output</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Price impact</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Slippage</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Minimum received</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Network fee</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <div className="review-row"><span className="k">Creator fee</span><span className="v"><DataValue point={unavailable} format={() => ''} /></span></div>
        <button className="btn btn-brand btn-block" style={{ marginTop: 16 }} disabled title="Needs a real DEX adapter — Stage 10">
          Trading not available yet
        </button>
        <p className="hint" style={{ marginTop: 10, textTransform: 'none' }}>
          The <code>DexAdapter</code> interface (quote, swap, route comparison) already exists in{' '}
          <code>packages/dex</code> — no Raydium/Orca implementation exists behind it yet. This button
          stays inert until that's real; never a simulated fill.
        </p>
      </div>

      <div className="tabbar" style={{ marginTop: 28 }} role="tablist" id="token-tabs">
        {TABS.map((t, i) => (
          <button key={t} role="tab" aria-selected={i === 0 ? 'true' : 'false'} type="button" data-tab={t}>{t}</button>
        ))}
      </div>

      <div id="token-panels" style={{ marginTop: 24 }}>
        {/* Overview */}
        <div data-panel="Overview">
          <div className="card">
            <div className="review-row"><span className="k">Description</span><span className="v" style={{ display: 'flex', gap: 8 }}><span className="data-unavailable">Unavailable</span><SourceTag source="creator-provided" /></span></div>
            <div className="review-row"><span className="k">Website</span><span className="v" style={{ display: 'flex', gap: 8 }}><span className="data-unavailable">Unavailable</span><SourceTag source="creator-provided" /></span></div>
            <div className="review-row"><span className="k">Contract address</span><span className="v" style={{ display: 'flex', gap: 8 }}><span className="data-unavailable">Unavailable</span><SourceTag source="blockchain-derived" /></span></div>
          </div>
        </div>

        {/* Chart — spec section 10: never generate fake historical candles */}
        <div data-panel="Chart" hidden>
          <div className="empty-state">
            <h3>Historical data unavailable</h3>
            <p>Chart data comes from indexed trade history — Stage 11. No candles are ever generated to fill the gap.</p>
          </div>
        </div>

        <div data-panel="Trades" hidden>
          <div className="empty-state">
            <h3>No indexed trades yet</h3>
            <p>Real trade history populates once Stage 9 (trading) and Stage 11 (indexer) exist.</p>
          </div>
        </div>

        <div data-panel="Holders" hidden>
          <div className="empty-state">
            <h3>No indexed holders yet</h3>
            <p>A real holder list and concentration breakdown needs the indexer (Stage 11) or a live on-chain scan.</p>
          </div>
        </div>

        {/* Signal Check — "Know Before You Buy", spec section 12. Facts
            only, each with its real source. No safety score, ever. */}
        <div data-panel="Signal Check" hidden>
          <div className="card">
            <SourcedRow label="Mint authority" data={sourcedUnavailable('blockchain-derived')} format={(v: boolean) => (v ? 'Active' : 'Renounced')} />
            <SourcedRow label="Freeze authority" data={sourcedUnavailable('blockchain-derived')} format={(v: boolean) => (v ? 'Active' : 'Renounced')} />
            <SourcedRow label="Creator holdings" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => `${v}%`} />
            <SourcedRow label="Top 10 holder concentration" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => `${v}%`} />
            <SourcedRow label="Liquidity" data={sourcedUnavailable('third-party')} format={(v: number) => `$${v}`} />
            <SourcedRow label="Deployment transaction" data={sourcedUnavailable('blockchain-derived')} format={(v: string) => v} />
            <SourcedRow label="Community reports" data={sourcedUnavailable('community-reported')} format={(v: number) => `${v} report(s)`} />
          </div>
          <div className="how-box" style={{ marginTop: 14 }}>
            These are facts, not a verdict. Signal never labels a token "safe" or assigns a
            safety score — see <a href="/security" style={{ color: 'var(--brand)' }}>Security</a> and{' '}
            <a href="/transparency" style={{ color: 'var(--brand)' }}>Transparency Center</a>.
          </div>
        </div>

        <div data-panel="Signal Trace" hidden>
          <div className="trace-shell">
            <div className="trace-head">
              <div>
                <span className="trace-kicker">Wallet Intelligence</span>
                <h2>Signal Trace</h2>
                <p>Follow observable wallet relationships, funding paths and project history — with evidence attached to every connection.</p>
              </div>
              <span className="badge badge-placeholder">Awaiting indexed evidence</span>
            </div>
            <div className="trace-workspace">
              <div className="trace-canvas" aria-label="Signal Trace relationship map">
                <div className="trace-grid" aria-hidden="true" />
                <div className="trace-empty-node" aria-hidden="true">
                  <span className="trace-node-ring" />
                  <span className="trace-node-core">S</span>
                </div>
                <div className="trace-empty-copy">
                  <strong>No indexed relationships yet</strong>
                  <span>Connections will appear only when Signal has blockchain-derived evidence.</span>
                </div>
              </div>
              <aside className="trace-evidence">
                <span className="trace-kicker">Evidence panel</span>
                <h3>Select a connection</h3>
                <p>Wallets, transactions, funding relationships and previous projects will be explained here when real indexed evidence is available.</p>
                <div className="trace-evidence-row"><span>Source</span><strong>Unavailable</strong></div>
                <div className="trace-evidence-row"><span>Evidence level</span><strong>Unavailable</strong></div>
                <div className="trace-evidence-row"><span>Transaction</span><strong>Unavailable</strong></div>
                <div className="trace-rule">A wallet connection does not prove common ownership or malicious behaviour.</div>
              </aside>
            </div>
          </div>
        </div>

        <div data-panel="Creator" hidden>
          <div className="card">
            <SourcedRow label="Creator wallet" data={sourcedUnavailable('blockchain-derived')} format={(v: string) => v} />
            <SourcedRow label="Tokens launched" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => String(v)} />
          </div>
        </div>

        <div data-panel="Transactions" hidden>
          <div className="empty-state">
            <h3>No indexed transactions yet</h3>
            <p>Deployment and transfer history populates from the indexer — Stage 11.</p>
          </div>
        </div>

        <div data-panel="Community" hidden>
          {/* This page is a static layout template — it can't know a real
              mint address at server-render time (no dynamic per-address
              routing here; see the file header). token-detail.js reads
              ?mint= from the URL at runtime: if present, it reconfigures
              the ChatRoom below to that token's real room and mounts it;
              otherwise it stays hidden and the "no token selected" state
              shows instead. Reuses the exact same component as the main
              community room, so the two can't drift apart visually. */}
          <div data-token-chat-unselected>
            <div className="empty-state">
              <h3>No token selected</h3>
              <p>
                Open this tab from an actual token — for example a token you've launched, from{' '}
                <a href="/dashboard" style={{ color: 'var(--brand)' }}>your Dashboard</a> — to see and
                join that token's own chatroom.
              </p>
            </div>
          </div>
          <div data-token-chat-mount hidden>
            <ChatRoom endpoint="" roomId="" label="this token's room" />
          </div>
        </div>
      </div>
    </div>
  );
}
