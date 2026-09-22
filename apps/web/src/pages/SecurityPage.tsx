import React from 'react';

/** Spec section 33. Content mirrors docs/SECURITY.md — one real source of
 *  truth, two presentations (engineer-facing markdown, user-facing page).
 *
 *  Expanded per an explicit content brief: every added claim is checked
 *  against the actual implementation (SolanaAdapter.ts's authority
 *  assignment, packages/types' DEFAULT_TAX_CONFIG, the chat backend's
 *  real signature/rate-limit/moderation logic) rather than written as
 *  generic trust-page copy. No new claims of audits, certifications,
 *  partnerships, deployed contracts, or guarantees — where the honest
 *  answer is "not yet" or "not implemented," that's what's said. */

const ICONS = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinejoin="round" strokeLinecap="round" />,
  key: <path d="M15 7a4 4 0 10-4 4l-6 6v2h2l1-1h2v-2h2l1.5-1.5" strokeLinejoin="round" strokeLinecap="round" />,
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
  'Signal does not custody user funds at any point in the launch or trading flow.',
  'Always read a wallet prompt before approving it — check the network, the destination, and the amount.',
  'Hardware wallets can be used wherever the connected wallet software supports them.',
  "Signal does not generate, store, or have access to a user's private key, on any chain.",
];

const LAUNCH_VERIFY_POINTS = [
  'The token mint address itself, once a launch confirms',
  'Mint authority — who can mint additional supply',
  'Freeze authority — who can freeze a holder\u2019s token account',
  'Total supply and decimals as configured at launch',
  'The creator wallet that submitted the launch',
  'The fee recipient and exact amount before signing',
  'Token metadata as provided at creation',
  'Other on-chain state relevant to that specific mint',
];

const AUTHORITIES = [
  {
    title: 'Mint authority',
    body: 'Controls whether more tokens can be minted. In the current Solana launch flow this remains with the creator, so supply can increase until that authority is revoked. Verify its current state on-chain.',
  },
  {
    title: 'Freeze authority',
    body: "Controls whether a holder's token account can be frozen. New tokens created through Signal set no freeze authority, but externally indexed tokens may differ — always inspect the mint itself.",
  },
  {
    title: 'Update and metadata control',
    body: 'Metadata and update authority depend on how a token was created. Signal never treats a creator-provided name, image, description, or social link as independently verified.',
  },
  {
    title: 'Trading and liquidity permissions',
    body: 'Liquidity pools, bonding curves, and trading venues have their own rules and authorities. These are separate from the token mint and must be checked at the venue or on-chain program involved.',
  },
];

const NOT_DO_POINTS: Array<{ text: string; icon: React.ReactNode }> = [
  { text: "We don't hold your seed phrase.", icon: ICONS.x },
  { text: "We don't hold your private key.", icon: ICONS.x },
  { text: "We don't custody your funds.", icon: ICONS.x },
  { text: "We don't guarantee token performance.", icon: ICONS.x },
  { text: 'We don\u2019t label a token "safe" based on a proprietary score.', icon: ICONS.x },
  { text: "We don't hide material on-chain facts.", icon: ICONS.x },
];

const PROOF_EXAMPLES = [
  'Holder concentration', 'Liquidity', 'Mint authority', 'Freeze authority',
  'Total supply', 'Creator wallet', 'Market source', 'Other available on-chain data',
];

const SIGNING_TIPS = [
  'Check that the wallet address you\u2019re signing with is actually the one you intended to use.',
  "Check the network — a signature meant for one chain should never be approved on another.",
  'Read what the transaction actually does before approving it, not just the amount.',
  'Never approve a transaction whose effect you don\u2019t understand.',
  'Never share a seed phrase or private key with anyone or anything — Signal will never ask for one.',
  'Be cautious of links or sites claiming to be Signal that you didn\u2019t navigate to directly.',
  'If a prompt looks unexpected in any way, reject it and check first.',
];

const PRINCIPLES = [
  { title: 'Verify, don\u2019t assume.', body: 'Every material fact here links back to something you can check yourself, on-chain.' },
  { title: 'Your keys, your control.', body: 'Signal never holds a key or a seed phrase — every signature is yours alone.' },
  { title: 'Facts over scores.', body: 'Mint authority, freeze authority, holders, liquidity — shown as data, never as a verdict.' },
  { title: 'Transparency over promises.', body: 'What isn\u2019t built yet is labeled as such, not implied to already exist.' },
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
        <p>Signal is designed to make the important on-chain facts visible before you interact with a token.</p>
      </div>

      <div className="container-narrow">
        {/* ---- 2. Wallet & key security ---- */}
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

        {/* ---- 3. Token launch security ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Token launch security</span>
            <h2>What you can verify about a launch.</h2>
            <p>Signal shows these facts directly; you can also independently verify every one of them on a block explorer before ever signing a transaction.</p>
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

        {/* ---- 4. Current and planned fees ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Fees</span>
            <h2>Current charges and planned capabilities, stated separately.</h2>
          </div>
          <div className="card">
            <div className="review-row"><span className="k">Current Solana launch fee</span><span className="v">0.001 SOL, one time</span></div>
            <div className="review-row"><span className="k">Recipient</span><span className="v">Signal platform wallet</span></div>
            <div className="review-row"><span className="k">Network costs</span><span className="v">Separate Solana rent and transaction fees</span></div>
            <div className="review-row"><span className="k">Token transfer tax</span><span className="v">None on new Signal launches</span></div>
          </div>
          <p style={{ color: 'var(--ink-faint)', font: 'var(--text-small)', marginTop: 14, lineHeight: 1.6 }}>
            The current browser launch flow creates a classic Solana SPL token and includes the fixed 0.001 SOL
            Signal launch fee in the transaction. The wallet displays the transaction for approval. Signal does
            not add a Token-2022 transfer tax to new launches.
          </p>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="review-row"><span className="k">Signal trading fee</span><span className="v">1% of the gross SOL amount</span></div>
            <div className="review-row"><span className="k">Recipient</span><span className="v">Signal platform wallet</span></div>
            <div className="review-row"><span className="k">Applies to</span><span className="v">Solana buys executed through Signal</span></div>
            <div className="review-row"><span className="k">Live today</span><span className="v">Solana buy execution</span></div>
          </div>
          <p style={{ color: 'var(--ink-faint)', font: 'var(--text-small)', marginTop: 14, lineHeight: 1.6 }}>
            The 1% Signal fee is not charged on wallet-to-wallet transfers or trades completed on an external
            exchange. On a Signal-routed buy, the swap and fee are atomic: both succeed or both fail. The complete
            transaction is presented in the user's wallet before signing. No holder reward is promised.
          </p>
        </section>

        <div className="section-divider" role="presentation" />

        {/* ---- 5. Token authorities ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Token authorities</span>
            <h2>Controls worth understanding.</h2>
            <p>Different contracts and programs control different parts of a token's lifecycle. Verify current state directly on-chain rather than assuming it from a website description.</p>
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

        {/* ---- 6. What Signal does not do ---- */}
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

        {/* ---- 7. Proof before you buy ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Proof before you buy</span>
            <h2>Facts, shown as facts — not a "safe" score.</h2>
            <p>Signal exposes the on-chain facts that matter rather than compressing them into a misleading safety verdict. You still make your own decision about what "safe enough" means for you.</p>
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

        {/* ---- 8. Smart contract / code transparency ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Code transparency</span>
            <h2>What's actually running underneath.</h2>
          </div>
          <div className="icon-list">
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.link} /></span>
              <p>New Solana launches use the established classic SPL Token program. Signal does not fork or modify the token program.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.alert} /></span>
              <p>Using an established protocol does not mean using Signal removes all risk. Signal itself has not undergone a professional security audit.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.shield} /></span>
              <p>Base and BNB Chain token discovery is live. Signal creation and in-app trading on those chains are planned, not live.</p>
            </div>
            <div className="icon-list-item">
              <span className="icon"><Icon d={ICONS.x} /></span>
              <p>No audit, certification, or partnership is claimed anywhere on this site unless it has actually happened.</p>
            </div>
          </div>
        </section>

        <div className="section-divider" role="presentation" />

        {/* ---- 9. User signing safety ---- */}
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

        {/* ---- 10. Current security status ---- */}
        <section className="security-section">
          <div className="security-section-head">
            <span className="kicker">Current status</span>
            <h2>Where this platform actually is today.</h2>
          </div>
          <div className="status-card">
            <div className="status-card-inner">
              <ul>
                <li><span className="dot" aria-hidden="true" />Signal is a live beta with Solana Mainnet token creation and multi-chain discovery.</li>
                <li><span className="dot" aria-hidden="true" />Portfolio balances, persistent community chat, and wallet-scoped dashboard data are live.</li>
                <li><span className="dot" aria-hidden="true" />In-app trading is not live; token pages currently link to external markets.</li>
                <li><span className="dot" aria-hidden="true" />Features and supported networks may change as the platform develops.</li>
                <li><span className="dot" aria-hidden="true" />Always verify the current on-chain state before signing.</li>
              </ul>
            </div>
          </div>
        </section>

        <div className="section-divider" role="presentation" />
      </div>

      {/* ---- 11. Security principles ---- */}
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
