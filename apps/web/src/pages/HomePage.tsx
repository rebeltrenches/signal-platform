import React from 'react';
import { SignalMark } from '../components/SignalMark.js';

const FEATURES = [
  {
    title: 'Launch on three chains',
    body: 'Solana, Base, and BNB Chain from one flow. Same review screen, same wallet-confirmation step, whichever chain you pick.',
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M4.5 7.5L12 12l7.5-4.5 M12 12v9" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: 'Proof before you buy',
    body: 'Mint authority, holder concentration, liquidity — shown as facts, never as a score. You decide what "safe enough" means.',
    icon: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z M9 12l2 2 4-4" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: 'A fee you can verify on-chain',
    body: '100% of the Transfer Fee goes to the token\u2019s own creator \u2014 enforced by the token contract itself, not a promise in a whitepaper.',
    icon: <path d="M12 21a9 9 0 100-18 9 9 0 000 18z M9.5 15.5l5-7 M14 15.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M10 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" strokeLinejoin="round" strokeLinecap="round" />,
  },
];

const STEPS = [
  { n: '01', title: 'Connect a wallet', body: 'Phantom for Solana, or an EVM wallet for Base and BNB.' },
  { n: '02', title: 'Configure your token', body: 'Name, symbol, supply — plus the fixed 3% transfer fee where supported.' },
  { n: '03', title: 'Review, then sign', body: 'Every parameter shown before your wallet ever asks for a signature.' },
  { n: '04', title: 'Live once confirmed', body: 'Not before — a launch is never marked done until the chain says so.' },
];

export function HomePage() {
  return (
    <>
      <section className="hero container-narrow">
        <div className="signal-pulse-wrap" style={{ width: 112, height: 112, margin: '0 auto 32px auto' }}>
          <span className="signal-pulse-ring" aria-hidden="true" />
          <span className="signal-pulse-ring delay-1" aria-hidden="true" />
          <span className="signal-pulse-ring delay-2" aria-hidden="true" />
          <SignalMark size={80} className="signal-pulse-core" />
        </div>
        <h1>Launch a token you can actually explain.</h1>
        <p>
          A multi-chain launchpad built around one idea: show what's true,
          not what's reassuring. Facts over scores, real state over
          placeholders.
        </p>
        <div className="hero-actions">
          <a href="/create" className="btn btn-brand btn-lg">Create a token</a>
          <a href="/explore" className="btn btn-ghost btn-lg">Explore launches</a>
        </div>
      </section>

      <section className="container">
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.6">
                  {f.icon}
                </svg>
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container" style={{ marginTop: 88, marginBottom: 40 }}>
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
    </>
  );
}
