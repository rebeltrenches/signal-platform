import React from 'react';
import { CHAIN_CONFIGS } from '@launchpad/config';
import { DEFAULT_TAX_CONFIG, PROTOCOL_MAX_TAX_BPS } from '@launchpad/types';
import { bpsToDisplay } from '@launchpad/utils';

const LAUNCH_CHAINS = ['solana', 'base', 'bnb']; // mainnet entries only for the picker; devnet is a toggle, not a separate tile
const errorStyle = { color: 'var(--down)', textTransform: 'none', minHeight: '1.2em' } as const;

export function CreatePage() {
  const totalPct = bpsToDisplay(DEFAULT_TAX_CONFIG.totalBps);

  return (
    <div className="container-narrow" style={{ paddingTop: 36, paddingBottom: 80 }}>
      <div className="page-head" style={{ display: 'block', paddingTop: 0 }}>
        <h1>Create a token</h1>
        <p>Create a real Solana Mainnet token from your own wallet. Base and BNB token creation is planned, not live.</p>
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
                  {c.taxSupported ? `${totalPct} creator trading fee planned for Signal-routed trades` : 'Discovery live — token creation and trading planned'}
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
        <p className="hint" style={{ textTransform: 'none', marginBottom: 16 }}>
          The name, symbol, logo and description become your token's permanent on-chain metadata. They can never be
          changed after launch.
        </p>
        <div className="field">
          <label htmlFor="tk-name">Token name</label>
          <input className="input" id="tk-name" placeholder="e.g. Signal Coin" aria-describedby="tk-name-error" />
          <p id="tk-name-error" className="hint" style={errorStyle}></p>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tk-symbol">Symbol</label>
            <input className="input" id="tk-symbol" placeholder="e.g. SIGNAL" maxLength={10} aria-describedby="tk-symbol-error" />
            <p id="tk-symbol-error" className="hint" style={errorStyle}></p>
          </div>
          <div className="field">
            <label htmlFor="tk-logo">Logo</label>
            <input className="input" id="tk-logo" type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-describedby="tk-logo-hint tk-logo-error" />
            <div id="tk-logo-hint" className="hint">PNG, JPEG, GIF or WebP, up to 100 KB. Stored permanently on Arweave.</div>
            <p id="tk-logo-error" className="hint" style={errorStyle}></p>
            <img id="tk-logo-preview" alt="Logo preview" width={64} height={64} style={{ borderRadius: 12, objectFit: 'cover' }} hidden />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tk-desc">Description (optional)</label>
          <textarea className="input" id="tk-desc" rows={4} placeholder="What is this token for?" aria-describedby="tk-desc-error" />
          <p id="tk-desc-error" className="hint" style={errorStyle}></p>
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
            {/* Deliberately empty: decimals are permanent, so the creator types them. */}
            <input className="input" id="tk-decimals" inputMode="numeric" aria-describedby="tk-decimals-hint tk-decimals-error" />
            <div id="tk-decimals-hint" className="hint">Most Solana tokens use 6 or 9.</div>
            <p id="tk-decimals-error" className="hint" style={{ color: 'var(--down)', textTransform: 'none', minHeight: '1.2em' }}></p>
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
                The creator-fee SOL trading path is being completed before it is enabled.
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
          <div className="review-row"><span className="k">Logo</span><span className="v"><img id="rv-logo" alt="Logo" width={48} height={48} style={{ borderRadius: 10, objectFit: 'cover' }} hidden /></span></div>
          <div className="review-row"><span className="k">Name</span><span className="v" id="rv-name">—</span></div>
          <div className="review-row"><span className="k">Symbol</span><span className="v" id="rv-symbol">—</span></div>
          <div className="review-row"><span className="k">Description</span><span className="v" id="rv-description">—</span></div>
          <div className="review-row"><span className="k">Token metadata</span><span className="v">Permanent — can never be changed</span></div>
          <div className="review-row"><span className="k">Logo + metadata storage</span><span className="v">Arweave via ArDrive Turbo — free; if free storage is refused, you see the SOL cost and approve it first</span></div>
          <div className="review-row"><span className="k">Metadata account</span><span className="v">≈0.0137 SOL (0.0037 SOL rent + Metaplex's 0.01 SOL protocol fee)</span></div>
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
            Base and BNB Chain token creation is not live yet. Solana is the currently supported
            deployment chain — select it in Step 1 to continue with a real Mainnet launch.
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

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" id="metadataAck" style={{ marginTop: 3 }} />
              I've checked the logo, name, symbol and description above. They're stored permanently on Arweave and
              on-chain, and can never be changed. Your wallet signs each file (a message, not a transaction).
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-dim)', marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" id="mainnetAck" style={{ marginTop: 3 }} />
              I understand this sends a real Solana Mainnet transaction using real SOL from my connected
              wallet, and that it cannot be reversed. The full supply is minted to my wallet and then
              locked: no more tokens can ever be minted.
            </label>

            <button type="button" className="btn btn-brand btn-block" id="mainnetLaunchBtn" disabled>
              Connect wallet and confirm to launch
            </button>

            <div id="launch-steps" style={{ marginTop: 16, display: 'none' }}>
              <div className="review-row" data-launch-step="upload"><span className="k">1. Store logo + metadata on Arweave</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="mint"><span className="k">2. Create mint + token metadata + 0.001 SOL SIGNAL launch fee</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="supply"><span className="k">3. Mint total supply + revoke mint authority</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="lock"><span className="k">4. Verify supply locked on-chain</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="meta"><span className="k">5. Verify token metadata on-chain</span><span className="v" data-state>Not started</span></div>
            </div>
            <div id="launch-result" style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--ink-dim)', wordBreak: 'break-all', lineHeight: 1.8 }}></div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
        </div>
      </section>

      {/* Outside the wizard steps: always available. launch-solana.js wires it. */}
      <details id="list-existing" className="tax-box" style={{ marginTop: 28 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>List an existing token</summary>
        <p className="hint" style={{ textTransform: 'none', margin: '8px 0 14px' }}>
          Already launched a token from your wallet but it isn't listed on Signal? Enter its mint address. Signal checks
          on-chain that your connected wallet created it and that its mint authority is revoked, and your wallet signs a
          sign-in message (no transaction, no SOL).
        </p>
        <div className="field">
          <label htmlFor="le-mint">Mint address</label>
          <input className="input" id="le-mint" autoComplete="off" spellCheck={false} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="le-name">Token name</label>
            <input className="input" id="le-name" />
          </div>
          <div className="field">
            <label htmlFor="le-symbol">Symbol</label>
            <input className="input" id="le-symbol" maxLength={10} />
          </div>
        </div>
        <button type="button" className="btn btn-brand" id="le-submit">Connect wallet and list</button>
        <div id="le-result" style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--ink-dim)', wordBreak: 'break-all', lineHeight: 1.8 }}></div>
      </details>
    </div>
  );
}
