import React from 'react';

/** User-facing security description of the implementation in this branch.
 * Keep this page aligned with docs/SECURITY.md and the actual launch/trading
 * code. Do not claim an audit, certification, deployment or guarantee that
 * has not happened. */

const ICONS = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinejoin="round" strokeLinecap="round" />,
  wallet: <path d="M3 7a2 2 0 012-2h11a2 2 0 012 2v1h1a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM16 12h.01" strokeLinecap="round" />,
  eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" strokeLinejoin="round" strokeLinecap="round" />,
  check: <path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />,
  x: <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />,
  alert: <path d="M12 3l9 16H3l9-16z M12 10v4M12 17h.01" strokeLinejoin="round" strokeLinecap="round" />,
  doc: <path d="M6 3h8l4 4v14H6V3z M14 3v4h4 M9 12h6 M9 15h6 M9 9h2" strokeLinejoin="round" strokeLinecap="round" />,
  link: <path d="M10 14a4 4 0 005.66 0l2-2a4 4 0 00-5.66-5.66l-1 1 M14 10a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1" strokeLinecap="round" strokeLinejoin="round" />,
};

function Icon({ d, size = 15 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--brand-hover)" strokeWidth="1.8">
      {d}
    </svg>
  );
}

const WALLET_POINTS = [
  'Signal never asks for a seed phrase or private key, in the app or anywhere else.',
  "Every wallet action is signed by the user's own connected wallet — Phantom for Solana, or an EVM wallet for Base and BNB.",
  'Signal does not hold a user account balance or take control of a connected wallet. SOL paid into a bonding curve becomes on-chain curve liquidity governed by the program rules.',
  'Always read a wallet prompt before approving it — check the network, destination, amount and action.',
  'Hardware wallets can be used wherever the connected wallet software supports them.',
  "Signal does not generate, store, or have access to a user's private key, on any chain.",
];

const LAUNCH_VERIFY_POINTS = [
  'The token mint address and creator wallet once the launch confirms',
  'Mint authority and freeze authority',
  'Total supply and decimals as configured at launch',
  'The program-owned bonding-curve account and token vault',
  'Curve inventory, reserved graduation inventory and bonding progress',
  'Launch and trading-fee recipients and amounts',
  'Immutable token metadata created by the Signal launch flow',
  'Graduation state and Raydium pool address after migration',
];

const AUTHORITIES = [
  {
    title: 'Mint authority',
    body: 'For a Signal bonding-curve launch, the fixed supply is minted into the program-owned curve vault — not into the creator wallet — and mint authority is revoked. The creator receives 0 tokens automatically. Once revocation is confirmed on-chain, no additional supply can be minted. Externally indexed tokens may differ.',
  },
  {
    title: 'Freeze authority',
    body: "New tokens created through Signal set no freeze authority. Externally indexed tokens can have different settings, so inspect their current mint state independently.",
  },
  {
    title: 'Curve and graduation inventory',
    body: 'The Signal curve uses 79.31% of the fixed supply as real bonding-curve inventory. The remaining 20.69% stays in the program-owned vault for post-curve liquidity. It is not an automatic creator allocation.',
  },
  {
    title: 'Trading and liquidity',
    body: 'Before graduation, Signal-created tokens buy and sell against the on-chain constant-product curve. A standard final fill includes the one-time Raydium CPMM graduation in the same atomic transaction. A permissionless recovery graduation remains available if a curve is completed outside that normal path. The migration LP tokens are burned by the Signal program after pool creation.',
  },
];

const NOT_DO_POINTS: Array<{ text: string; icon: React.ReactNode }> = [
  { text: "We don't hold your seed phrase or private key.", icon: ICONS.x },
  { text: "We don't silently allocate the full token supply to the creator wallet.", icon: ICONS.x },
  { text: "We don't guarantee token performance or future liquidity.", icon: ICONS.x },
  { text: 'We don\u2019t label a token "safe" based on a proprietary score.', icon: ICONS.x },
  { text: "We don't hide material on-chain authority or curve facts.", icon: ICONS.x },
];

const PROOF_EXAMPLES = [
  'Bonding-curve progress', 'Curve reserves', 'Holder concentration', 'Liquidity',
  'Mint authority', 'Freeze authority', 'Total supply', 'Creator wallet', 'Graduation pool', 'Market source',
];

const SIGNING_TIPS = [
  'Check that the wallet address you\u2019re signing with is the one you intended to use.',
  "Check the network — a signature meant for one chain should never be approved on another.",
  'Read what the transaction does before approving it, not just the amount.',
  'On a final curve fill, check that the wallet is asking you to approve the combined curve purchase and graduation transaction you requested.',
  'Never approve a transaction whose effect you don\u2019t understand.',
  'Never share a seed phrase or private key with anyone — Signal will never ask for one.',
  'If a prompt looks unexpected, reject it and check first.',
];

const PRINCIPLES = [
  { title: 'Verify, don\u2019t assume.', body: 'Material launch and trading facts should be checkable on-chain.' },
  { title: 'Your keys, your control.', body: 'Signal never receives your seed phrase or private key; wallet signatures remain yours.' },
  { title: 'Facts over scores.', body: 'Authorities, reserves, holders and liquidity are shown as data, not compressed into a safety verdict.' },
  { title: 'Fail closed.', body: 'If the Signal bonding-curve program is not configured and deployed for the build, new curve launches are disabled rather than falling back to the old full-supply-to-creator flow.' },
];

export function SecurityPage() {
  return (
    <div style={{ paddingBottom: 80 }}>
      <div className="container-narrow security-hero">
        <span className="hero-eyebrow">
          <span className="hero-eyebrow-dot" aria-hidden="true" />
          Security &amp; Transparency
        </span>
        <h1>Security starts with what you can verify.</h1>
        <p>Signal is designed to expose the important on-chain facts before you launch, buy, sell or graduate a token.</p>
      </div>

      <div className="container-narrow">
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Wallet &amp; key security</span>
            <h2>Your wallet stays yours.</h2>
          </div>
          <div className="icon-list">
            {WALLET_POINTS.map((p) => (
              <div className="icon-list-item" key={p}>
                <span className="icon"><Icon d={ICONS.wallet} /></span>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Token launch security</span>
            <h2>What you can verify about a Signal launch.</h2>
            <p>The launch flow reads critical state back from Solana instead of relying only on what the browser intended to send.</p>
          </div>
          <div className="icon-list">
            {LAUNCH_VERIFY_POINTS.map((p) => (
              <div className="icon-list-item" key={p}>
                <span className="icon"><Icon d={ICONS.eye} /></span>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Fees</span>
            <h2>Launch and trading charges are separate.</h2>
          </div>
          <div className="card">
            <div className="review-row"><span className="k">Solana launch fee</span><span className="v">0.001 SOL, one time</span></div>
            <div className="review-row"><span className="k">Launch-fee recipient</span><span className="v">Signal platform wallet</span></div>
            <div className="review-row"><span className="k">Network / account costs</span><span className="v">Separate Solana rent and transaction costs</span></div>
            <div className="review-row"><span className="k">Token transfer tax</span><span className="v">None on new Signal launches</span></div>
          </div>
          <p style={{ color: 'var(--ink-faint)', font: 'var(--text-small)', marginTop: 14, lineHeight: 1.6 }}>
            Signal-created tokens use the classic SPL Token program. The fixed launch charge is separate from network,
            metadata and account-creation costs shown by the wallet. Signal does not add a Token-2022 transfer tax.
          </p>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="review-row"><span className="k">Signal curve trading fee</span><span className="v">1% in SOL</span></div>
            <div className="review-row"><span className="k">Recipient</span><span className="v">Signal platform wallet</span></div>
            <div className="review-row"><span className="k">Before graduation</span><span className="v">Applies to Signal-curve buys and sells</span></div>
            <div className="review-row"><span className="k">Wallet transfers</span><span className="v">No Signal trading fee</span></div>
          </div>
          <p style={{ color: 'var(--ink-faint)', font: 'var(--text-small)', marginTop: 14, lineHeight: 1.6 }}>
            The curve program enforces the 1% SOL fee as part of each curve trade. A failed curve transaction does not
            separately complete the fee transfer. After graduation, trading uses the available external-market route;
            fees and supported actions are shown by the trading interface before signing.
          </p>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Token authorities &amp; liquidity</span>
            <h2>Controls worth understanding.</h2>
            <p>Token authorities, curve custody and DEX liquidity are different on-chain controls. Signal shows them separately rather than treating them as one vague "locked" status.</p>
          </div>
          <div className="authority-grid">
            {AUTHORITIES.map((a) => (
              <div className="authority-card" key={a.title}>
                <h3><span className="dot" aria-hidden="true" />{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">What Signal does not do</span>
            <h2>Said plainly, not buried in a footnote.</h2>
          </div>
          <div className="icon-list">
            {NOT_DO_POINTS.map((n) => (
              <div className="icon-list-item" key={n.text}>
                <span className="icon"><Icon d={n.icon} /></span>
                <p>{n.text}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Proof before you buy</span>
            <h2>Facts, shown as facts — not a "safe" score.</h2>
            <p>Signal exposes relevant evidence rather than turning it into a guarantee or recommendation.</p>
          </div>
          <div className="icon-list">
            {PROOF_EXAMPLES.map((p) => (
              <div className="icon-list-item" key={p}>
                <span className="icon"><Icon d={ICONS.doc} /></span>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Code transparency</span>
            <h2>What's actually underneath the launch path.</h2>
          </div>
          <div className="icon-list">
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.link} /></span>
              <p>Signal-created Solana tokens use the classic SPL Token program plus Signal's own on-chain bonding-curve program for reserve state, curve trades and graduation.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.shield} /></span>
              <p>The browser launch path is fail-closed: without a configured executable Signal curve program, token launching is disabled instead of reverting to the legacy full-supply-to-creator behavior.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.alert} /></span>
              <p>The bonding-curve code has automated build and test checks, but Signal has not undergone an independent professional smart-contract security audit. Passing automated tests is not an audit.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.shield} /></span>
              <p>Base and BNB Chain discovery is live. Signal token creation and in-app trading on those chains remain planned.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.x} /></span>
              <p>No audit, certification, partnership or guarantee is claimed unless it has actually happened.</p>
            </div>
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">User signing safety</span>
            <h2>Before you approve anything.</h2>
          </div>
          <div className="icon-list">
            {SIGNING_TIPS.map((t) => (
              <div className="icon-list-item" key={t}>
                <span className="icon"><Icon d={ICONS.check} /></span>
                <p>{t}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Current status</span>
            <h2>What is implemented, and what still needs production review.</h2>
          </div>
          <div className="status-card">
            <div className="status-card-inner">
              <ul>
                <li><span className="dot" aria-hidden="true" />The Signal curve program implements constant-product buy/sell pricing, 1% SOL curve fees, fixed-supply vault custody and one-time Raydium CPMM graduation.</li>
                <li><span className="dot" aria-hidden="true" />The standard final curve buy and Raydium graduation are built as one atomic transaction; if either instruction fails, neither completes.</li>
                <li><span className="dot" aria-hidden="true" />A permissionless graduation instruction remains as recovery for a curve that reaches completion outside the standard Signal trading path.</li>
                <li><span className="dot" aria-hidden="true" />The program has automated Rust, browser-integration and deployable-SBF build checks. It still requires independent security review and controlled on-chain testing before production enablement.</li>
                <li><span className="dot" aria-hidden="true" />Externally discovered tokens are not assumed to use Signal's launch, authority or liquidity model.</li>
                <li><span className="dot" aria-hidden="true" />Always verify current on-chain state and read every wallet prompt before signing.</li>
              </ul>
            </div>
          </div>
        </section>

        <div className="section-divider" role="presentation" />
      </div>

      <section className="container" style={{ marginTop: 56 }}>
        <span className="section-eyebrow">Security principles</span>
        <h2 style={{ font: 'var(--text-h1)', textAlign: 'center', marginBottom: 8 }}>What this page won't change.</h2>
        <div className="approach-grid">
          {PRINCIPLES.map((p) => (
            <div className="approach-card" key={p.title}>
              <div className="icon" aria-hidden="true"><Icon d={ICONS.shield} size={18} /></div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
