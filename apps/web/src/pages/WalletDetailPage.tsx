import React from 'react';
import { EmptyState } from '../components/EmptyState.js';
import { SourcedRow } from '../components/SourcedValue.js';
import { sourcedUnavailable } from '@launchpad/types';

const TABS = ['Holdings', 'Trades', 'Created tokens', 'Signal Passport', 'Bubble Map'];

/** Layout template for /wallet/[chain]/[address] — master spec sections
 *  14 ("Wallet Intelligence") and 15 ("Signal Passport"). Real
 *  tab-switching, real evidence-sourced fields, all honestly
 *  "Unavailable" until Stage 11 (indexer) exists to populate them. The
 *  Signal Passport tab is explicitly NOT a safety certificate — the
 *  spec's own words — every relationship shown would carry its own
 *  evidence source and confidence level, never a claim that two wallets
 *  belong to the same person without real evidence. */
export function WalletDetailPage() {
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="badge" id="wallet-intelligence-status" style={{ marginTop: 24 }}>
        Wallet Intelligence — loading indexed evidence
      </div>
      <div className="page-head">
        <div>
          <h1 style={{ fontFamily: 'monospace', fontSize: '1.4rem' }}>0x…, or a Solana address</h1>
          <p>Holdings, activity, and Signal Passport for this wallet.</p>
        </div>
      </div>
      <div className="tabbar" role="tablist" id="wallet-tabs">
        {TABS.map((t, i) => (
          <button key={t} role="tab" aria-selected={i === 0 ? 'true' : 'false'} data-tab={t} type="button">{t}</button>
        ))}
      </div>

      <div id="wallet-panels" style={{ marginTop: 24 }}>
        <div data-panel="Holdings">
          <div id="wallet-holdings-list"></div>
          <div id="wallet-holdings-empty"><EmptyState title="No indexed holdings yet" body="No holder snapshots are currently available for this wallet." /></div>
        </div>
        <div data-panel="Trades" hidden>
          <div id="wallet-activity-list"></div>
          <div id="wallet-activity-empty"><EmptyState title="No indexed activity yet" body="No wallet activity has been indexed for this address." /></div>
        </div>
        <div data-panel="Created tokens" hidden>
          {/* Real list renders here (wallet-detail.js) — the empty
              state below stays default until real data actually loads,
              reusing the exact same GET /api/v1/tokens/mine endpoint
              Dashboard's "Your launches" already uses since Stage 2.
              No new backend code. Holdings/Trades panels are untouched
              — genuinely still blocked on Stage 11/live RPC. */}
          <div id="wallet-created-tokens-list"></div>
          <div id="wallet-created-tokens-empty">
            <EmptyState title="No launches indexed for this wallet yet" body="Tokens created by this wallet, once indexed." />
          </div>
        </div>
        <div data-panel="Bubble Map" hidden>
          <div id="wallet-bubble-map">
            <div className="empty-state" id="wallet-bubble-map-empty">
              <h3>No Signal Trace available yet</h3>
              <p>The Bubble Map appears only when blockchain-derived funding relationships with transaction evidence are available.</p>
            </div>
          </div>
          <div className="how-box" style={{ marginTop: 14 }}>
            Bubble Map connections represent observed transaction paths only. They do not claim common ownership or identity.
          </div>
        </div>
        <div data-panel="Signal Passport" hidden>
          <div className="card">
            <div id="wallet-tokens-launched-row">
              <SourcedRow label="Tokens launched" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => String(v)} />
            </div>
            <div id="wallet-first-observed-row"><SourcedRow label="First observed activity" data={sourcedUnavailable('blockchain-derived')} format={(v: string) => v} /></div>
          </div>
          <h3 style={{ font: 'var(--text-h2)', fontSize: '1rem', margin: '20px 0 10px 0' }}>Wallet relationships</h3>
          <div id="wallet-relationships-list"></div>
          <div className="empty-state" id="wallet-relationships-empty">
            <h3>No observed relationships yet</h3>
            <p>Real relationships — funding, shared liquidity, co-signed transactions — populate from indexed on-chain history, each with its own evidence and confidence level. Never a claim that two wallets belong to the same person without that evidence.</p>
          </div>
          <div className="how-box" style={{ marginTop: 14 }}>
            Signal Passport is an information record, not a safety certificate or endorsement.
            See <a href="/transparency" style={{ color: 'var(--brand)' }}>Transparency Center</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
