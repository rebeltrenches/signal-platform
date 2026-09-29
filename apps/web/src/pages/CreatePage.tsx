import React from 'react';
import { CHAIN_CONFIGS } from '@launchpad/config';
import { DEFAULT_TAX_CONFIG } from '@launchpad/types';
import { bpsToDisplay } from '@launchpad/utils';

const LAUNCH_CHAINS = ['solana', 'base', 'bnb'];
const errorStyle = { color: 'var(--down)', textTransform: 'none', minHeight: '1.2em' } as const;

export function CreatePage() {
  const totalPct = bpsToDisplay(DEFAULT_TAX_CONFIG.totalBps);

  return (
    <div className="container-narrow" style={{ paddingTop: 36, paddingBottom: 80 }}>
      <div className="page-head" style={{ display: 'block', paddingTop: 0 }}>
        <h1>Create a token</h1>
        <p>
          Launch a Solana token into Signal's on-chain bonding curve. The creator does not automatically receive the supply;
          the program-owned curve holds it for public price discovery.
        </p>
      </div>

      {/* Always visible so an interrupted mint -> curve initialization can be recovered. */}
      <div id="pending-launch-notice" hidden></div>

      <div className="stepper" id="stepper">
        <div className="seg active" data-seg="0"></div>
        <div className="seg" data-seg="1"></div>
        <div className="seg" data-seg="2"></div>
        <div className="seg" data-seg="3"></div>
      </div>

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
                  {c.taxSupported ? `${totalPct} Signal trading fee on Signal curve trades` : 'Discovery live — token creation and trading planned'}
                </span>
              </button>
            );
          })}
        </div>

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

      <section className="wizard-step" data-step="1" hidden>
        <div className="step-label"><span className="current">Step 2 of 4</span><span>Token info</span></div>
        <p className="hint" style={{ textTransform: 'none', marginBottom: 16 }}>
          The name, symbol, logo and description become permanent on-chain metadata and cannot be changed after launch.
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
            <input className="input" id="tk-logo" type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-describedby="tk-logo-hint tk-logo-info tk-logo-error" />
            <div id="tk-logo-hint" className="hint">Any PNG, JPEG, GIF or WebP image up to 5 MB — we'll resize it for you (max 512×512, under 100 KB). Animated GIFs become a still image of the first frame. Stored permanently on Arweave.</div>
            <p id="tk-logo-info" className="hint" aria-live="polite"></p>
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
            <input className="input" id="tk-decimals" inputMode="numeric" aria-describedby="tk-decimals-hint tk-decimals-error" />
            <div id="tk-decimals-hint" className="hint">Most Solana tokens use 6 or 9.</div>
            <p id="tk-decimals-error" className="hint" style={{ color: 'var(--down)', textTransform: 'none', minHeight: '1.2em' }}></p>
          </div>
        </div>

        <div className="field">
          <label>Bonding curve</label>
          <div className="tax-box">
            <div className="review-row"><span className="k">Curve sale inventory</span><span className="v">79.31% of total supply</span></div>
            <div className="review-row"><span className="k">Graduation liquidity reserve</span><span className="v">20.69% of total supply</span></div>
            <div className="review-row"><span className="k">Creator automatic allocation</span><span className="v">0%</span></div>
            <div className="review-row"><span className="k">Starting virtual SOL reserve</span><span className="v">30 SOL</span></div>
            <p className="hint" style={{ marginTop: 12, textTransform: 'none' }}>
              The entire supply is held by the Signal bonding-curve program. Buyers move the price along a constant-product
              curve. The creator receives tokens only by buying from the same curve as everyone else.
            </p>
          </div>
        </div>

        <div className="field">
          <label>Signal trading fee</label>
          <div id="tax-display">
            <div className="tax-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ font: 'var(--text-h2)' }}>{totalPct}</span>
                <span className="hint" style={{ textTransform: 'none' }}>fixed on Signal bonding-curve buys and sells</span>
              </div>
              <div className="review-row" style={{ marginTop: 10 }}><span className="k">Signal platform wallet</span><span className="v">100% of the Signal trading fee</span></div>
              <div className="review-row"><span className="k">Token creator</span><span className="v" style={{ color: 'var(--ink-faint)' }}>0% of the Signal trading fee</span></div>
              <div className="review-row"><span className="k">Fee asset</span><span className="v">SOL</span></div>
              <div className="review-row"><span className="k">Holder rewards</span><span className="v" style={{ color: 'var(--ink-faint)' }}>None</span></div>
              <p className="hint" style={{ marginTop: 12, textTransform: 'none' }}>
                The {totalPct} Signal fee is settled in SOL by the bonding-curve program. It is not a token transfer tax.
                Signal's separate current launch charge is 0.001 SOL.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
          <button type="button" className="btn btn-brand" data-action="next" disabled>Review</button>
        </div>
      </section>

      <section className="wizard-step" data-step="3" hidden>
        <div className="step-label"><span className="current">Step 4 of 4</span><span>Review</span></div>
        <div className="card" id="review-summary">
          <div className="review-row"><span className="k">Chain</span><span className="v" id="rv-chain">—</span></div>
          <div className="review-row"><span className="k">Logo</span><span className="v"><img id="rv-logo" alt="Logo" width={48} height={48} style={{ borderRadius: 10, objectFit: 'cover' }} hidden /></span></div>
          <div className="review-row"><span className="k">Name</span><span className="v" id="rv-name">—</span></div>
          <div className="review-row"><span className="k">Symbol</span><span className="v" id="rv-symbol">—</span></div>
          <div className="review-row"><span className="k">Description</span><span className="v" id="rv-description">—</span></div>
          <div className="review-row"><span className="k">Token metadata</span><span className="v">Permanent — can never be changed</span></div>
          <div className="review-row"><span className="k">Logo + metadata storage</span><span className="v">Arweave via ArDrive Turbo</span></div>
          <div className="review-row"><span className="k">Total supply</span><span className="v" id="rv-supply">—</span></div>
          <div className="review-row"><span className="k">Decimals</span><span className="v" id="rv-decimals">—</span></div>
          <div className="review-row"><span className="k">Launch model</span><span className="v">On-chain constant-product bonding curve</span></div>
          <div className="review-row"><span className="k">Curve inventory</span><span className="v">79.31%</span></div>
          <div className="review-row"><span className="k">Reserved for graduation liquidity</span><span className="v">20.69%</span></div>
          <div className="review-row"><span className="k">Automatic creator tokens</span><span className="v">0%</span></div>
          <div className="review-row"><span className="k">Signal trading fee</span><span className="v" id="rv-creator-fee">—</span></div>
          <div className="review-row"><span className="k">Trading fee recipient</span><span className="v">Signal platform wallet</span></div>
          <div className="review-row"><span className="k">SIGNAL launch fee</span><span className="v">0.001 SOL</span></div>
          <div className="review-row"><span className="k">Holder rewards</span><span className="v" id="rv-holder-reward">—</span></div>
          <div className="review-row"><span className="k">Creator wallet</span><span className="v" id="rv-creator-wallet-live" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>Not connected</span></div>
        </div>

        <div className="empty-state" id="launch-evm-notice" style={{ marginTop: 20, textAlign: 'left', padding: 20 }} hidden>
          <strong style={{ color: 'var(--ink-dim)' }}>Not available on this chain yet.</strong>
          <p style={{ marginTop: 6 }}>Base and BNB Chain token creation is not live yet. Select Solana to use the live bonding-curve launch path.</p>
        </div>

        <div id="launch-mainnet-panel">
          <div className="tax-box" style={{ marginTop: 20, borderColor: 'var(--down)' }}>
            <p style={{ color: 'var(--down)', fontWeight: 700, marginBottom: 8 }}>
              This creates a REAL token and REAL bonding curve on Solana Mainnet using REAL SOL. It cannot be undone.
            </p>
            <p className="hint" style={{ textTransform: 'none', marginBottom: 14 }}>
              The full supply is placed under the Signal bonding-curve program, not in the creator wallet. 79.31% is available
              through the curve and 20.69% stays reserved in the same program-owned vault for graduation liquidity. The creator
              starts with 0 tokens automatically and can buy from the curve like any other wallet.
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
              I've checked the logo, name, symbol and description. The metadata becomes permanent after launch.
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-dim)', marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" id="mainnetAck" style={{ marginTop: 3 }} />
              I understand the supply is minted to the program-owned bonding-curve vault, not to my wallet; I receive no
              automatic token allocation; and each transaction shown in Phantom is irreversible once confirmed.
            </label>

            <button type="button" className="btn btn-brand btn-block" id="mainnetLaunchBtn" disabled>
              Connect wallet and confirm to launch
            </button>

            <div id="launch-steps" style={{ marginTop: 16, display: 'none' }}>
              <div className="review-row" data-launch-step="upload"><span className="k">1. Store logo + metadata on Arweave</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="mint"><span className="k">2. Create mint + immutable metadata</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="curve"><span className="k">3. Mint full supply to curve vault + revoke mint authority + initialize curve + 0.001 SOL SIGNAL launch fee</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="lock"><span className="k">4. Verify program custody, supply and authorities on-chain</span><span className="v" data-state>Not started</span></div>
              <div className="review-row" data-launch-step="meta"><span className="k">5. Verify immutable token metadata</span><span className="v" data-state>Not started</span></div>
            </div>
            <div id="launch-result" style={{ marginTop: 12, fontSize: '0.8125rem', color: 'var(--ink-dim)', wordBreak: 'break-all', lineHeight: 1.8 }}></div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button type="button" className="btn btn-ghost" data-action="back">Back</button>
        </div>
      </section>

      <details id="list-existing" className="tax-box" style={{ marginTop: 28 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>List an existing token</summary>
        <p className="hint" style={{ textTransform: 'none', margin: '8px 0 14px' }}>
          Already launched elsewhere? You can list the token for discovery. Listing an existing token does not make it a Signal
          bonding-curve launch and does not move its supply into Signal custody.
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
