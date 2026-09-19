import React from 'react';
import { SignalMark } from '../components/SignalMark.js';

const APPROACH = [
  {
    eyebrow: 'ON-CHAIN FACTS',
    title: 'See what the chain actually says.',
    body: 'Mint authority, holder concentration, liquidity and other important facts are presented from the underlying state — not reduced to a mystery score.',
    icon: <path d="M4 6.5L12 3l8 3.5v11L12 21l-8-3.5v-11z M4 6.5L12 10l8-3.5 M12 10v11" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    eyebrow: 'CLEAR INFORMATION',
    title: 'Understand before you act.',
    body: 'Signal is designed to show sources and context so you can make your own decision instead of being handed a reassuring label.',
    icon: <path d="M12 4v16 M7 8h10 M7 12h7 M7 16h5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    eyebrow: 'YOUR KEYS, YOUR CONTROL',
    title: 'Your wallet stays yours.',
    body: 'Connect and sign with your own wallet. Signal does not ask for seed phrases or private keys.',
    icon: <path d="M7 11V8a5 5 0 0110 0v3 M5 11h14v9H5v-9z M12 15v2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    eyebrow: 'A STRONGER COMMUNITY',
    title: 'Share what you can verify.',
    body: 'Community discussion, reporting and token-specific chat give people a place to compare information and surface useful facts.',
    icon: <path d="M5 6h14v10H9l-4 4V6z M8 10h8 M8 13h5" strokeLinecap="round" strokeLinejoin="round" />,
  },
];

const CHAINS = [
  { name: 'Solana', detail: '3.00% transfer fee', state: 'LIVE', className: 'solana' },
  { name: 'Base', detail: 'Launch support', state: 'SUPPORTED', className: 'base' },
  { name: 'BNB Chain', detail: 'Launch support', state: 'SUPPORTED', className: 'bnb' },
];

export function HomePage() {
  return (
    <>
      <section className="v3-hero">
        <div className="v3-hero-grid">
          <div className="v3-hero-copy">
            <div className="v3-kicker">
              <span className="v3-kicker-dot" aria-hidden="true" />
              Multi-chain token infrastructure
            </div>

            <h1>
              Launch a token
              <br />
              you can actually <span>explain.</span>
            </h1>

            <p>
              A multi-chain launchpad built around one idea: show what&apos;s true,
              not what&apos;s reassuring. Facts over scores, real state over
              placeholders.
            </p>

            <div className="v3-hero-actions">
              <a href="/create" className="btn btn-brand btn-lg">Create a token <span aria-hidden="true">→</span></a>
              <a href="/explore" className="btn btn-ghost btn-lg">Explore launches</a>
            </div>

            <div className="v3-proof-row">
              <div><span className="v3-proof-icon">✦</span><span>Transparent by design</span></div>
              <div><span className="v3-proof-icon">◈</span><span>Facts, not scores</span></div>
              <div><span className="v3-proof-icon">⌁</span><span>Community driven</span></div>
            </div>
          </div>

          <div className="v3-hero-art" aria-hidden="true">
            <div className="v3-nebula v3-nebula-a" />
            <div className="v3-nebula v3-nebula-b" />
            <div className="v3-stars" />
            <div className="v3-orbit v3-orbit-a" />
            <div className="v3-orbit v3-orbit-b" />

            <div className="v3-coin">
              <div className="v3-coin-rim v3-coin-rim-back" />
              <div className="v3-coin-face">
                <div className="v3-coin-grid" />
                <div className="v3-coin-glow" />
                <div className="v3-coin-mark">
                  <SignalMark size={205} glow />
                </div>
                <div className="v3-coin-label">SIGNAL</div>
              </div>
              <div className="v3-coin-rim v3-coin-rim-front" />
            </div>

            <div className="v3-planet">
              <div className="v3-planet-glow" />
              <div className="v3-planet-surface" />
              <div className="v3-planet-grid" />
            </div>
          </div>
        </div>
      </section>

      <section className="container v3-chain-wrap" aria-label="Supported chains">
        <div className="v3-chain-panel">
          {CHAINS.map((chain) => (
            <div className={`v3-chain ${chain.className}`} key={chain.name}>
              <div className="v3-chain-mark" aria-hidden="true">{chain.name === 'Solana' ? '≋' : chain.name === 'Base' ? '◒' : '◆'}</div>
              <div>
                <strong>{chain.name}</strong>
                <span>{chain.detail}</span>
              </div>
              <em>{chain.state}</em>
            </div>
          ))}
          <div className="v3-chain-more">
            <span>+</span>
            <div><strong>More chains</strong><span>coming soon</span></div>
            <b aria-hidden="true">→</b>
          </div>
        </div>
      </section>

      <section className="container v3-approach">
        <div className="v3-section-heading">
          <div className="v3-section-kicker">OUR APPROACH</div>
          <h2>Built for a more transparent crypto economy.</h2>
          <p>Signal gives you the facts that matter, directly from the blockchain — so you can make your own decisions with confidence.</p>
        </div>

        <div className="v3-approach-grid">
          {APPROACH.map((item, index) => (
            <article className="v3-approach-card" key={item.eyebrow}>
              <div className="v3-card-number">0{index + 1}</div>
              <div className="v3-card-icon" aria-hidden="true">
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45">
                  {item.icon}
                </svg>
              </div>
              <div className="v3-card-eyebrow">{item.eyebrow}</div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <div className="v3-card-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="container v3-future">
        <div className="v3-future-art" aria-hidden="true">
          <div className="v3-mountain v3-mountain-back" />
          <div className="v3-mountain v3-mountain-mid" />
          <div className="v3-mountain v3-mountain-front" />
          <div className="v3-future-haze" />
          <div className="v3-future-stars" />
        </div>
        <div className="v3-future-content">
          <div className="v3-section-kicker">A CLEARER FUTURE</div>
          <h2>Better information<br /><span>builds a safer tomorrow.</span></h2>
          <p>Explore real on-chain information, understand what you&apos;re signing, and join a community built around transparency.</p>
          <div className="v3-hero-actions">
            <a href="/explore" className="btn btn-brand btn-lg">Explore launches <span aria-hidden="true">→</span></a>
            <a href="/transparency" className="btn btn-ghost btn-lg">Learn more</a>
          </div>
        </div>
      </section>

      <section className="container v3-final-space" aria-hidden="true">
        <div className="v3-final-line" />
      </section>
    </>
  );
}
