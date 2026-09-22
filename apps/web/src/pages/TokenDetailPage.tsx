import React from 'react';
import type { DataPoint } from '@launchpad/types';
import { sourcedUnavailable } from '@launchpad/types';
import { DataValue } from '../components/DataUnavailable.js';
import { SourcedRow, SourceTag } from '../components/SourcedValue.js';
import { ChatRoom } from '../components/ChatRoom.js';

const TABS = ['Overview', 'Chart', 'Trades', 'Holders', 'Signal Check', 'Creator', 'Transactions', 'Community'];

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
        Token workspace — unavailable fields are never replaced with estimates
      </div>

      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }} />
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span id="token-name"><DataValue point={unavailable} format={() => ''} /></span>
              <span className="badge" id="token-chain">Solana</span>
              <span className="badge badge-placeholder" id="signal-launch-badge" title="Whether this token was created through Signal, or discovered from elsewhere — master spec section 23">
                Launched on Signal: Unavailable
              </span>
            </h1>
            <p id="token-address" style={{ fontFamily: 'monospace', fontSize: 12 }}>Contract address unavailable — no token indexed at this path yet</p>
            <a id="token-source-market" href="#" target="_blank" rel="noopener noreferrer" hidden style={{ color: 'var(--brand)', fontSize: 12 }}>Open source market ↗</a>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Price</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Market cap</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Liquidity</div></div>
        <div className="stat"><div className="v"><DataValue point={unavailable} format={() => ''} /></div><div className="l">Holders</div></div>
      </div>

      <div className="card" style={{ marginTop: 20 }} id="trade-terminal">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="chip" aria-pressed="true" type="button" id="trade-buy">Buy</button>
          <button className="chip" aria-pressed="false" type="button" disabled title="Sell quoting will be enabled after token-decimal loading is complete">Sell</button>
        </div>
        <label htmlFor="trade-amount" style={{ display: 'block', marginBottom: 7, color: 'var(--ink-dim)', fontSize: 13 }}>Amount in SOL</label>
        <input className="input" id="trade-amount" placeholder="0.05" inputMode="decimal" style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['0.01', '0.05', '0.10', '0.50'].map((p) => (
            <button key={p} className="chip" type="button" data-trade-preset={p}>{p} SOL</button>
          ))}
        </div>
        <div className="review-row"><span className="k">Router</span><span className="v" id="trade-router">Not quoted</span></div>
        <div className="review-row"><span className="k">Routed amount</span><span className="v" id="trade-routed">—</span></div>
        <div className="review-row"><span className="k">Expected output</span><span className="v" id="trade-output">—</span></div>
        <div className="review-row"><span className="k">Price impact</span><span className="v" id="trade-impact">—</span></div>
        <div className="review-row"><span className="k">Signal trading fee</span><span className="v" id="trade-signal-fee">1% of the gross SOL amount</span></div>
        <div className="review-row"><span className="k">Execution</span><span className="v" id="trade-execution">Wallet confirmation required</span></div>
        <button className="btn btn-brand btn-block" style={{ marginTop: 16 }} type="button" id="trade-quote-btn">
          Preview live route
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} type="button" id="trade-execute-btn">
          Connect wallet to trade
        </button>
        <p id="trade-status" role="status" style={{ marginTop: 10, color: 'var(--ink-dim)', fontSize: 13 }} />
        <p className="hint" style={{ marginTop: 10, textTransform: 'none' }}>
          Signal builds one atomic Solana transaction containing the routed purchase and the 1% Signal fee.
          Phantom shows the transaction for approval; Signal never receives your private key. If any
          instruction fails, the entire transaction fails and no fee is transferred.
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
            <p>Charts appear only when verified market-history data is available. Signal never generates candles to fill a gap.</p>
          </div>
        </div>

        <div data-panel="Trades" hidden>
          <div className="empty-state">
            <h3>No indexed trades yet</h3>
            <p>Trades appear only when a verified market data source or Signal's future on-chain trading index provides them.</p>
          </div>
        </div>

        <div data-panel="Holders" hidden>
          <div className="empty-state">
            <h3>No indexed holders yet</h3>
            <p>Holder balances and concentration appear only after a successful on-chain read or verified indexed snapshot.</p>
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

        <div data-panel="Creator" hidden>
          <div className="card">
            <SourcedRow label="Creator wallet" data={sourcedUnavailable('blockchain-derived')} format={(v: string) => v} />
            <SourcedRow label="Tokens launched" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => String(v)} />
          </div>
        </div>

        <div data-panel="Transactions" hidden>
          <div className="empty-state">
            <h3>No indexed transactions yet</h3>
            <p>Deployment and transfer history appears only when Signal has verifiable on-chain transaction evidence.</p>
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
