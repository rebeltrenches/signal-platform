import React from 'react';
import { SignalMark } from '../components/SignalMark.js';

const APPROACH = [
  {
    title: 'On-chain facts',
    body: 'Mint authority, freeze authority, holder data, liquidity and more — read directly from the chain.',
    icon: 'search',
  },
  {
    title: 'Clear information',
    body: 'Every fact shows its source. No hidden interpretation, no misleading scores.',
    icon: 'doc',
  },
  {
    title: 'Your keys, your control',
    body: 'You always sign in your own wallet. Signal never asks for your seed phrase or private key.',
    icon: 'shield',
  },
  {
    title: 'A stronger community',
    body: 'Community reports, discussions, and real transparency — all in one place.',
    icon: 'users',
  },
];

function FeatureIcon({ type }: { type: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M16 16l5 5" /></>,
    doc: <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v5h4M9 13h6M9 16h5" /></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
    users: <><circle cx="9" cy="9" r="3.5" /><circle cx="17" cy="10" r="2.7" /><path d="M2.8 20c.6-3.4 2.8-5.2 6.2-5.2s5.6 1.8 6.2 5.2M15 15.2c3.5-.1 5.4 1.5 6.2 4.8" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

function SignalCoin() {
  return (
    <div className="signal-coin" aria-hidden="true">
      <img src="/assets/signal-logo-full.png" alt="" />
    </div>
  );
}

function ChainIcon({ chain }: { chain: 'solana' | 'base' | 'bnb' }) {
  if (chain === 'base') return <span className="chain-icon chain-icon-base">—</span>;
  if (chain === 'bnb') return <span className="chain-icon chain-icon-bnb">◆</span>;
  return <span className="chain-icon chain-icon-sol">S</span>;
}

export function HomePage() {
  return (
    <main className="signal-home">
      <section className="hero-v4">
        <div className="hero-v4-space" aria-hidden="true" />
        <div className="hero-v4-earth" aria-hidden="true"><span className="earth-lights" /></div>
        <div className="hero-v4-inner container">
          <div className="hero-v4-copy">
            <span className="hero-v4-eyebrow"><span className="hero-v4-eyebrow-dot" />Multi-chain launchpad</span>
            <h1>Launch a token<br />you can actually<br /><span>explain.</span></h1>
            <p>Signal is a multi-chain launchpad built around one idea: show what's true, not what's reassuring. Facts over scores, real state over placeholders.</p>
            <div className="hero-v4-actions">
              <a href="/create" className="btn btn-brand btn-lg">Create a token <b>→</b></a>
              <a href="/explore" className="btn btn-ghost btn-lg">Explore launches</a>
            </div>
            <div className="hero-trust-row">
              <div><span className="trust-icon"><FeatureIcon type="shield" /></span><span>Transparent<br />by design</span></div>
              <div><span className="trust-icon"><FeatureIcon type="doc" /></span><span>Facts, not<br />safety scores</span></div>
              <div><span className="trust-icon"><FeatureIcon type="users" /></span><span>Community<br />driven</span></div>
            </div>
          </div>
          <div className="hero-v4-visual">
            <div className="hero-side-note hero-side-note-top">MORE<br />THAN<br />MEMES<span /></div>
            <SignalCoin />
            <div className="hero-side-note hero-side-note-bottom">A<br />BRIGHTER<br />TOMORROW<br />ON-CHAIN<span /></div>
          </div>
        </div>
      </section>

      <section className="chain-bar-wrap container" aria-label="Supported chains">
        <div className="chain-bar">
          <div className="chain-item"><ChainIcon chain="solana" /><div><strong>Solana</strong><small>3.00% transfer fee<br />supported</small></div></div>
          <div className="chain-item"><ChainIcon chain="base" /><div><strong>Base</strong><small>Trading only<br />(for now)</small></div></div>
          <div className="chain-item"><ChainIcon chain="bnb" /><div><strong>BNB Chain</strong><small>Trading only<br />(for now)</small></div></div>
          <div className="chain-more"><span>MORE CHAINS<br />COMING SOON</span><b>›</b></div>
        </div>
      </section>

      <section className="approach-v4 container">
        <span className="section-eyebrow">Our approach</span>
        <h2>Built for a more transparent crypto economy.</h2>
        <p className="approach-lead">Signal gives you the facts that matter, directly from the blockchain — so you can make your own decisions with confidence.</p>
        <div className="approach-grid">
          {APPROACH.map((item) => (
            <article className="approach-card" key={item.title}>
              <span className="approach-icon"><FeatureIcon type={item.icon} /></span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="future-v4 container">
        <div className="future-v4-bg" aria-hidden="true" />
        <div className="future-v4-copy">
          <span className="section-eyebrow">A clearer future</span>
          <h2>Better information<br />builds a safer tomorrow.</h2>
          <p>Join a growing community that values transparency, education and real data.</p>
          <div className="hero-v4-actions">
            <a href="/explore" className="btn btn-brand">Explore launches <b>→</b></a>
            <a href="/transparency" className="btn btn-ghost">Learn more</a>
          </div>
        </div>
        <div className="future-v4-note">SAME CHAINS<br />HIGHER STANDARDS<br />BRIGHTER OPPORTUNITIES<span /></div>
        <div className="future-v4-signature">Signal <span>→</span><small>MORE THAN A LAUNCHPAD<br />A CLEARER TOMORROW</small></div>
      </section>
    </main>
  );
}
