import React from 'react';
import { EmptyState } from '../components/EmptyState.js';

const ICONS = {
  wallet: (
    <>
      <path d="M3 7a2 2 0 012-2h11a2 2 0 012 2v1h1a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      <path d="M16 12h.01" strokeLinecap="round" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c2.5 2 4 5 4 8.5 0 2-.5 3.5-1.5 5L12 19l-2.5-2.5c-1-1.5-1.5-3-1.5-5C8 8 9.5 5 12 3z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="1.6" />
      <path d="M9.5 16.5L7 19M14.5 16.5L17 19" strokeLinecap="round" />
    </>
  ),
  star: <path d="M12 4l2.2 5.6 6 .4-4.6 3.9 1.5 5.8-5.1-3.3-5.1 3.3 1.5-5.8-4.6-3.9 6-.4z" strokeLinejoin="round" />,
  bell: (
    <>
      <path d="M7 9a5 5 0 0110 0c0 4 1.5 5.5 1.5 5.5h-13S7 13 7 9z" strokeLinejoin="round" />
      <path d="M10 17a2 2 0 004 0" strokeLinecap="round" />
    </>
  ),
};

/** Doubles as the "wallet/account area" — the account view IS the
 *  dashboard's header once connected, rather than a separate near-duplicate
 *  page. The generic /wallet/[chain]/[address] template (WalletDetailPage)
 *  covers viewing *any* wallet's public activity; this page is specifically
 *  "your own session."
 *
 *  Phase 7 (2026-09-17): Portfolio and Watchlist are now genuinely real,
 *  not placeholders — Portfolio reads real on-chain balances for the
 *  connected wallet (client/portfolio.js); Watchlist is real, persistent
 *  (localStorage) add/remove, not a mock. "Your launches" becomes real
 *  the moment someone actually completes a real launch via
 *  client/launch-solana.js, which records it here — until then it's
 *  honestly empty, not pre-filled with fake entries. Notifications stay
 *  Coming Soon — real-time triggering needs infrastructure (Stage 11/19)
 *  this build can't fake. */
export function DashboardPage() {
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your launches, holdings, and watchlist.</p>
        </div>
      </div>

      <div data-dashboard-state="disconnected">
        <EmptyState
          icon={ICONS.wallet}
          title="Connect a wallet to see your dashboard"
          body="Your launches, positions, and watchlist are all scoped to your connected wallet — nothing to show until one's connected."
          cta={<button className="btn btn-brand" data-action="connect-from-dashboard">Connect wallet</button>}
        />
      </div>

      <div data-dashboard-state="connected" hidden>
        <div className="wallet-pill" style={{ display: 'inline-flex', marginBottom: 28 }}>
          <span className="live-dot is-live" />
          <span id="dashboard-wallet-addr" style={{ fontFamily: 'monospace' }} />
        </div>

        {/* ---- Portfolio: real on-chain data, fetched live, never fabricated ---- */}
        <div className="section-head">
          <h2>Portfolio</h2>
          <button className="btn btn-ghost" id="refreshPortfolioBtn" type="button">Fetch live balances</button>
        </div>
        <div id="portfolio-skeleton" style={{ display: 'none' }}>
          <div className="card">
            <div className="skel-row"><div className="skeleton" style={{ width: 90, height: 13 }} /><div className="skeleton" style={{ width: 130, height: 22 }} /></div>
            <div className="skel-row"><div className="skeleton" style={{ width: 140, height: 13 }} /><div className="skeleton" style={{ width: 80, height: 13 }} /></div>
            <div className="skel-row"><div className="skeleton" style={{ width: 110, height: 13 }} /><div className="skeleton" style={{ width: 60, height: 13 }} /></div>
          </div>
        </div>
        <div id="portfolio-empty">
          <EmptyState icon={ICONS.wallet} title="Balances not fetched yet" body="Nothing is shown until you actually fetch it — real SOL and token balances, read live from Solana Mainnet for your connected wallet. No placeholder numbers." />
        </div>
        <div className="card" id="portfolio-results" style={{ display: 'none' }}>
          <div className="portfolio-balance">
            <span className="l">SOL balance</span>
            <span className="v" id="portfolio-sol">—</span>
          </div>
          <div id="portfolio-tokens"></div>
        </div>

        <div className="dash-grid">
          {/* ---- Your launches: real, populated only by an actual completed launch ---- */}
          <div>
            <div className="section-head">
              <h2>Your launches</h2>
              <span className="count-badge" id="launches-count" hidden>0</span>
            </div>
            <div id="launches-empty">
              <EmptyState icon={ICONS.rocket} title="You haven't launched a token yet" body="Tokens you create will show up here with their real mint address — recorded only after an actual on-chain launch confirms, never before." cta={<a href="/create" className="btn btn-ghost">Create a token</a>} />
            </div>
            <div id="launches-list"></div>
          </div>

          {/* ---- Watchlist: real, persistent add/remove, with real
              cross-device sync once signed in (see auth-client.js /
              watchlist.js) ---- */}
          <div>
            <div className="section-head">
              <h2>Watchlist</h2>
              <span className="count-badge" id="watchlist-count" hidden>0</span>
            </div>
            <div className="field-row" style={{ marginBottom: 12 }}>
              <input className="input" id="watchlistInput" placeholder="Token name or address to track" />
              <button className="btn btn-brand" id="watchlistAddBtn" type="button">Add</button>
            </div>
            <div className="field-row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
              <span id="watchlist-sync-status" className="hint">Saved to this browser only.</span>
              <button className="btn btn-ghost" id="watchlistSyncBtn" type="button" style={{ padding: '4px 12px' }}>Sync across devices</button>
            </div>
            <div id="watchlist-empty">
              <EmptyState icon={ICONS.star} title="Your watchlist is empty" body="Add a token above — saved to this browser, and to your account if you're signed in." />
            </div>
            <div id="watchlist-list"></div>
          </div>

          {/* ---- Alerts: configuration only. No triggering, no
              notifications — see alerts/AlertRepository.ts. Requires
              being signed in (session), since an alert has no useful
              local-only form the way a watchlist entry does. ---- */}
          <div>
            <div className="section-head">
              <h2>Alerts</h2>
              <span className="count-badge" id="alerts-count" hidden>0</span>
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>Configuration only — Signal doesn't check thresholds or send notifications yet.</p>
            <div id="alerts-signed-out">
              <EmptyState icon={ICONS.bell} title="Sign in to configure alerts" body="Alerts are tied to your account, not this browser." />
              <button className="btn btn-ghost" id="alertsSignInBtn" type="button" style={{ marginTop: 12 }}>Sign in</button>
            </div>
            <div id="alerts-signed-in" hidden>
              <div className="field-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                <input className="input" id="alertTokenAddress" placeholder="Registered token address" style={{ flex: '2 1 220px' }} />
                <select className="input" id="alertKind" style={{ flex: '1 1 140px' }}>
                  <option value="price_move">Price move</option>
                  <option value="volume_move">Volume move</option>
                  <option value="liquidity_change">Liquidity change</option>
                  <option value="graduation">Graduation</option>
                </select>
                <input className="input" id="alertThreshold" type="number" placeholder="Threshold %" style={{ flex: '0 1 120px' }} />
                <button className="btn btn-brand" id="alertAddBtn" type="button">Add</button>
              </div>
              <p id="alerts-status" className="hint"></p>
              <div id="alerts-empty">
                <EmptyState icon={ICONS.bell} title="No alerts configured" body="Add one above for any token you've registered on Signal." />
              </div>
              <div id="alerts-list"></div>
            </div>
          </div>
        </div>

        {/* ---- Notifications: honestly Coming Soon ---- */}
        <div className="section-head">
          <h2>Notifications</h2>
        </div>
        <EmptyState icon={ICONS.bell} title="Coming Soon" body="Real notifications need something actually happening to notify about — a running indexer (Stage 11) and a delivery mechanism (Stage 15). Not built yet; not faked here." />
      </div>
    </div>
  );
}
