import React from 'react';
import { CHAIN_CONFIGS } from '@launchpad/config';
import { DEFAULT_TAX_CONFIG, PROTOCOL_MAX_TAX_BPS } from '@launchpad/types';
import { bpsToDisplay } from '@launchpad/utils';

const LAUNCH_CHAINS = ['solana', 'base', 'bnb']; // mainnet entries only for the picker; devnet is a toggle, not a separate tile

export function CreatePage() {
  const totalPct = bpsToDisplay(DEFAULT_TAX_CONFIG.totalBps);

  return (
    <div className="container-narrow" style={{ paddingTop: 36, paddingBottom: 80 }}>
      <div className="page-head" style={{ display: 'block', paddingTop: 0 }}>
        <h1>Create a token</h1>
        <p>Solana launches use the real wallet flow shown on the review step. Base and BNB launches remain unavailable.</p>
      </div>

      {/* Deliberately OUTSIDE the wizard-step hidden system: a mint
          created in step 1 whose supply-mint failed must be recoverable
          the moment this page loads, regardless of which wizard step
          the person happens to land on — not buried behind three
          "Next" clicks. Populated by launch-solana.js; empty and inert
          otherwise. */}
      <div id="pending-launch-notice" hidden></div>

      <div className="stepper" id="stepper">
        <div className="seg active" data-seg="0"></div>
        <div className="seg" data-seg="1"></div>
        <div className="seg" data-seg="2"></div>
        <div className="seg" data-seg="3"></div>
      </div>

      {/* ---- Step 0: Chain ---- */}
      <section className="wizard-step" data-step="0">
        <div className="step-label"><span className="current">Step 1 of 4</span><span>Chain</span></div>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 16 }}>Which chain are you launching on?</h2>
        <div className="chain-grid" id="chain-grid">
          {LAUNCH_CHAINS.map((key) => {
            const c = CHAIN_CONFIGS[key]!;
            return (
              <button
                key={key}
                type="button"
                className="chain-option"
                data-chain={c.chain}
                data-tax-supported={String(c.taxSupported)}
                aria-pressed="false"
              >
                <span className="chain-dot" style={{ background: `var(--chain-${c.chain})` }} />
                <span className="name">{c.displayName}</span>
                <span className="tax-note">
                  {c.taxSupported ? `${totalPct} creator trading fee supported` : 'Trading only — creator fee routing not available yet'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Optional, informational only — never gates "Continue". Base
            and BNB adapters aren't implemented yet (adapterImplemented:
            false in packages/config), so completing this wizard still
            can't produce a real launch on either chain regardless of
            wallet connection. This exists so a person can verify they
            have a compatible EVM wallet ahead of that work landing, not
            to imply it already has. Hidden by default; shown per-chain
            by evm-wallet.js reacting to the existing chain-selection
            clicks above — wizard.js's own validation/navigation logic
            is untouched. */}
        <div id="evm-connect-base" className="card" style={{ marginTop: 16, padding: 16 }} hidden>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, color: 'var(--ink-dim)', font: 'var(--text-small)' }}>
              Base launches aren't available yet — connecting now just confirms you have a compatible wallet.
            </p>
            <button type="button" className="btn btn-ghost" data-evm-connect="base">Connect Base wallet</button>
          </div>
          <p data-evm-status="base" className="hint" style={{ marginTop: 8 }}></p>
        </div>
        <div id="evm-connect-bnb" className="card" style={{ marginTop: 16, padding: 16 }} hidden>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, color: 'var(--ink-dim)', font: 'var(--text-small)' }}>
              BNB Chain launches aren't available yet — connecting now just confirms you have a compatible wallet.
            </p>
            <button type="button" className="btn btn-ghost" data-evm-connect="bnb">Connect BNB wallet</button>
          </div>
          <p data-evm-status="bnb" className="hint" style={{ marginTop: 8 }}></p>
        </div>
        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-brand" data-action="next" disabled>Continue</button>
        </div>
      </section>

      {/* ---- Step 1: Token info ---- */}
      <section className="wizard-step" data-step="1" hidden>
        <div className="step-label"><span className="current">Step 2 of 4</span><span>Token info</span></div>
        <div className="field">
          <label htmlFor="tk-name">Token name</label>
          <input className="input" id="tk-name" placeholder="e.g. Signal Coin" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tk-symbol">Symbol</label>
            <input className="input" id="tk-symbol" placeholder="e.g. SIGNAL" maxLength={10} />
          </div>
          <div className="field">
            <label htmlFor="tk-logo">Logo</label>
            <input className="input" id="tk-logo" type="file" accept="image/*" />
            <div className="hint">Preview only in this stage — nothing uploads or persists yet (needs storage, Stage 11+).</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="tk-desc">Description</label>
          <textarea className="input" id="tk-desc" rows={4} placeholder="What is this token for?" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
          <button type="button" className="btn btn-brand" data-action="next" disabled>Continue</button>
        </div>
      </section>

      {/* ---- Step 2: Configuration ---- */}
      <section className="wizard-step" data-step="2" hidden>
        <div className="step-label"><span className="current">Step 3 of 4</span><span>Configuration</span></div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tk-supply">Total supply</label>
            <input className="input" id="tk-supply" inputMode="numeric" placeholder="1000000000" />
            <p id="tk-supply-error" className="hint" style={{ color: 'var(--down)', textTransform: 'none', minHeight: '1.2em' }}></p>
          </div>
          <div className="field">
            <label htmlFor="tk-decimals">Decimals</label>
            <input className="input" id="tk-decimals" inputMode="numeric" defaultValue={6} />
          </div>
        </div>

        <div className="field">
          <label>Creator trading fee</label>
          <div id="tax-display">
            <div className="tax-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ font: 'var(--text-h2)' }}>{totalPct}</span>
                <span className="hint" style={{ textTransform: 'none' }}>Creator trading fee — fixed, not adjustable per launch</span>
              </div>
              <div className="review-row" style={{ marginTop: 10 }}><span className="k">Token creator</span><span className="v">100% of the creator trading fee</span></div>
              <div className="review-row"><span className="k">SIGNAL platform share</span><span className="v" style={{ color: 'var(--ink-faint)' }}>0% of creator trading fee</span></div>
              <div className="review-row"><span className="k">Payout asset</span><span className="v">SOL</span></div>
              <div className="review-row"><span className="k">Holder rewards</span><span className="v" style={{ color: 'var(--ink-faint)' }}>None</span></div>
              <p className="hint" style={{ marginTop: 12, textTransform: 'none' }}>
                The {totalPct} creator trading fee belongs to you, the token creator, and is designed to be
                paid in SOL rather than withheld in your project token. SIGNAL's separate launch fee is 0.001 SOL.
                The creator-fee SOL trading path is being completed before production launch.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
          <button type="button" className="btn btn-brand" data-action="next" disabled>Review</button>
        </div>
      </section>

      {/* ---- Step 3: Review ---- */}
      <section className="wizard-step" data-step="3" hidden>
        <div className="step-label"><span className="current">Step 4 of 4</span><span>Review</span></div>
        <div className="card" id="review-summary">
          <div className="review-row"><span className="k">Chain</span><span className="v" id="rv-chain">—</span></div>
          <div className="review-row"><span className="k">Name</span><span className="v" id="rv-name">—</span></div>
          <div className="review-row"><span className="k">Symbol</span><span className="v" id="rv-symbol">—</span></div>
          <div className="review-row"><span className="k">Total supply</span><span className="v" id="rv-supply">—</span></div>
          <div className="review-row"><span className="k">Decimals</span><span className="v" id="rv-decimals">—</span></div>
          <div className="review-row"><span className="k">Creator trading fee</span><span className="v" id="rv-creator-fee">—</span></div>
          <div className="review-row"><span className="k">Creator fee payout</span><span className="v">SOL</span></div>
          <div className="review-row"><span className="k">SIGNAL launch fee</span><span className="v">0.001 SOL</span></div>
          <div className="review-row"><span className="k">Holder rewards</span><span className="v" id="rv-holder-reward">—</span></div>
          <div className="review-row"><span className="k">Creator wallet</span><span className="v" id="rv-creator-wallet-live" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>Not connected</span></div>
        </div>

        {/* EVM chains: no real adapter exists — honest, not a fake flow */}
        <div className="empty-state" id="launch-evm-notice" style={{ marginTop: 20, textAlign: 'left', padding: 20 }} hidden>
          <strong style={{ color: 'var(--ink-dim)' }}>Not available on this chain yet.</strong>
          <p style={{ marginTop: 6 }}>
            Base and BNB Chain don't have a real deployment adapter yet (Stage 7, Coming Soon).
            Solana is the first fully functional deployment chain — select it in Step 1 to launch for real.
          </p>
        </div>

        {/* Solana: the real flow */}
        <div id="launch-mainnet-panel">
          <div className="tax-box" style={{ marginTop: 20, borderColor: 'var(--down)' }}>
            <p style={{ color: 'var(--down)', fontWeight: 700, marginBottom: 8 }}>
              This creates a REAL token on Solana Mainnet using REAL SOL. This cannot be undone.
            </p>
            <p className="hint" style={{ textTransform: 'none', marginBottom: 14 }}>
              Devnet is not offered — Mainnet is the only target. You'll be shown each transaction
              before signing, and every signature below is real and checkable on{' '}
              <a href="https://explorer.solana.com" target="_blank" style={{ color: 'var(--brand)' }}>Solana Explorer</a>.
              Network cost (rent + fees) is calculated live from the chain when you connect — typically
              a small fraction of one SOL, paid from your own wallet.
            </p>

            <div className="wallet-box" style={{ marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Wallet</div>
                <div className="addr" id="mainnetWalletAddr">Not connected</div>
              </div>
              <button type="button" className="connect-btn" id="mainnetConnectBtn">Connect Phantom</button>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-dim)', marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" id="mainnetAck" style={{ marginTop: 3 }} />
              I understand this sends a real Solana Mainnet transaction using real SOL from my connected
              wallet, and that it cannot be reversed.
            </label>

            <button type="button" className="btn btn-brand btn-block" id="mainnetLaunchBtn" disabled>
              Connect wallet and confirm to launch
            </button>

            <div id="launch-steps" style={{ marginTop: 16, display: 'none' }}>
              <div className="review-row" data-launch-step="mint"><span className="k">1. Create mint + 0.001 SOL SIGNAL launch fee</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="supply"><span className="k">2. Mint total supply</span><span className="v" data-state>Not started</span></div>
            </div>
            <div id="launch-result" style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--ink-dim)', wordBreak: 'break-all', lineHeight: 1.8 }}></div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
        </div>
      </section>
    </div>
  );
}
