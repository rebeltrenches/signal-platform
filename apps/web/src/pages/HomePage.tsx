import React from 'react';
import { SignalCoin } from '../components/SignalCoin.js';
import { CHAIN_CONFIGS } from '@launchpad/config';

const TRUST_POINTS = [
  {
    label: 'Transparent by design',
    icon: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z M9 12l2 2 4-4" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    label: 'Facts, not scores',
    icon: <path d="M7 4h10v16l-5-3-5 3V4z" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    label: 'Community driven',
    icon: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zm6 0a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M15 15c2.5 0 5 1.5 5 4.5" strokeLinejoin="round" strokeLinecap="round" />,
  },
];

const APPROACH = [
  {
    title: 'On-chain facts',
    body: 'Mint authority, freeze authority, holder data — read directly from the chain, never asserted.',
    icon: <path d="M11 2a9 9 0 100 18 9 9 0 000-18zM11 6v5l3.5 2" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: 'Clear information',
    body: 'Every fact shows its source — creator-provided, blockchain-derived, or community-reported. No hidden interpretation.',
    icon: <path d="M6 4h9l3 3v13H6V4z M15 4v3h3 M9 12h6 M9 15h6 M9 9h3" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: 'Your keys, your control',
    body: 'You always sign in your own wallet. Signal never asks for a seed phrase or private key.',
    icon: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z M9 12l2 2 4-4" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: 'A stronger community',
    body: 'Real chat, message reporting, and moderation on every token room — not a synthetic activity count.',
    icon: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zm6 0a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M15 15c2.5 0 5 1.5 5 4.5" strokeLinejoin="round" strokeLinecap="round" />,
  },
];

const STEPS = [
  { n: '01', title: 'Connect a wallet', body: 'Phantom for Solana, or an EVM wallet for Base and BNB.' },
  { n: '02', title: 'Configure your token', body: 'Name, symbol, supply — plus the fixed 1% Signal Fee where supported.' },
  { n: '03', title: 'Review, then sign', body: 'Every parameter shown before your wallet ever asks for a signature.' },
  { n: '04', title: 'Live once confirmed', body: 'Not before — a launch is never marked done until the chain says so.' },
];

const CHAIN_DOTS: Record<string, { bg: string; label: string }> = {
  solana: { bg: 'var(--chain-solana)', label: 'S' },
  base: { bg: 'var(--chain-base)', label: 'B' },
  bnb: { bg: 'var(--chain-bnb)', label: 'B' },
};

export function HomePage() {
  const solana = CHAIN_CONFIGS['solana'];
  const base = CHAIN_CONFIGS['base'];
  const bnb = CHAIN_CONFIGS['bnb'];

  return (
    <>
      <section className="container hero-split">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <span className="hero-eyebrow-dot" aria-hidden="true" />
            Multi-chain token infrastructure
          </span>
          <h1>Launch a token you can actually <span className="hero-accent">explain</span>.</h1>
          <p>
            Signal is a multi-chain launchpad built around one idea: show what's true,
            not what's reassuring. Facts over scores, real state over placeholders.
          </p>
          <div className="hero-actions">
            <a href="/create" className="btn btn-brand btn-lg">Create a token</a>
            <a href="/explore" className="btn btn-ghost btn-lg">Explore launches</a>
          </div>
          <div className="trust-row">
            {TRUST_POINTS.map((t) => (
              <div className="trust-item" key={t.label}>
                <span className="icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-hover)" strokeWidth="1.8">
                    {t.icon}
                  </svg>
                </span>
                {t.label}
              </div>
            ))}
          </div>
        </div>
        <div className="hero-emblem-side">
          <div className="hero-side-label hero-side-label-left" aria-hidden="true">
            <span>MORE</span><span>THAN</span><span>MEMES</span>
            <i />
          </div>
          <SignalCoin size={520} />
          <div className="hero-side-label hero-side-label-right" aria-hidden="true">
            <span>A</span><span>BRIGHTER</span><span>TOMORROW</span><span>ON-CHAIN</span>
            <i />
          </div>
        </div>
      </section>

      <section className="container">
        <div className="chain-bar">
          <div className="chain-bar-item">
            <span className="chain-bar-dot" style={{ background: CHAIN_DOTS.solana.bg }}>{CHAIN_DOTS.solana.label}</span>
            <div>
              <h4>{solana.displayName}</h4>
              <p>1.00% Signal Fee supported</p>
            </div>
          </div>
          <div className="chain-bar-item">
            <span className="chain-bar-dot" style={{ background: CHAIN_DOTS.base.bg }}>{CHAIN_DOTS.base.label}</span>
            <div>
              <h4>{base.displayName}</h4>
              <p>Trading only — transfer fee not available yet</p>
            </div>
          </div>
          <div className="chain-bar-item">
            <span className="chain-bar-dot" style={{ background: CHAIN_DOTS.bnb.bg }}>{CHAIN_DOTS.bnb.label}</span>
            <div>
              <h4>{bnb.displayName}</h4>
              <p>Trading only — transfer fee not available yet</p>
            </div>
          </div>
          <span className="chain-bar-more">More chains planned →</span>
        </div>
      </section>

      <section className="container" style={{ marginBottom: 64 }}>
        <span className="section-eyebrow">Our approach</span>
        <h2 style={{ font: 'var(--text-h1)', textAlign: 'center', marginBottom: 8 }}>Built for a more transparent crypto economy.</h2>
        <p style={{ textAlign: 'center', color: 'var(--ink-dim)', maxWidth: '56ch', margin: '0 auto' }}>
          Signal gives you the facts that matter, directly from the blockchain — so you can make your own decisions with confidence.
        </p>
        <div className="approach-grid">
          {APPROACH.map((a) => (
            <div className="approach-card" key={a.title}>
              <div className="icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-hover)" strokeWidth="1.6">
                  {a.icon}
                </svg>
              </div>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="section-divider" role="presentation" />

      <section className="container" style={{ marginTop: 72, marginBottom: 40 }}>
        <h2 style={{ font: 'var(--text-h1)', textAlign: 'center', marginBottom: 8 }}>How a launch works</h2>
        <p style={{ textAlign: 'center', color: 'var(--ink-dim)', maxWidth: '48ch', margin: '0 auto' }}>
          Four steps. Nothing hidden between them.
        </p>
        <div className="sequence">
          {STEPS.map((s) => (
            <div className="seq-step" key={s.n}>
              <span className="n">{s.n}</span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container">
        <div className="cta-panel">
          <div className="cta-panel-inner">
            <span className="cta-panel-eyebrow">A clearer future</span>
            <h2>Better information builds a safer tomorrow.</h2>
            <p>Join a community that values transparency, education, and real data over hype.</p>
            <div className="hero-actions" style={{ justifyContent: 'flex-start' }}>
              <a href="/explore" className="btn btn-brand btn-lg">Explore launches</a>
              <a href="/security" className="btn btn-ghost btn-lg">Read the Security page</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
