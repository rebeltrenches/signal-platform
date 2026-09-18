import React from 'react';
import { EmptyState } from '../components/EmptyState.js';
import { SourcedRow } from '../components/SourcedValue.js';
import { sourcedUnavailable } from '@launchpad/types';

const TABS = ['Holdings', 'Trades', 'Created tokens', 'Signal Passport'];

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
      <div className="badge badge-placeholder" style={{ marginTop: 24 }}>
        Layout template — real wallet activity needs Stage 11 + 14
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
          <EmptyState title="No indexed holdings yet" body="This page reads from the Holder table, populated by the indexer — Stage 11." />
        </div>
        <div data-panel="Trades" hidden>
          <EmptyState title="No indexed trades yet" body="Populated from WalletActivity — Stage 11." />
        </div>
        <div data-panel="Created tokens" hidden>
          <EmptyState title="No launches indexed for this wallet yet" body="Tokens created by this wallet, once indexed." />
        </div>
        <div data-panel="Signal Passport" hidden>
          <div className="card">
            <SourcedRow label="Tokens launched" data={sourcedUnavailable('blockchain-derived')} format={(v: number) => String(v)} />
            <SourcedRow label="First observed activity" data={sourcedUnavailable('blockchain-derived')} format={(v: string) => v} />
          </div>
          <h3 style={{ font: 'var(--text-h2)', fontSize: '1rem', margin: '20px 0 10px 0' }}>Wallet relationships</h3>
          <div className="empty-state">
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
