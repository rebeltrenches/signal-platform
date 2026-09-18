import React from 'react';

export function Footer() {
  return (
    <footer className="footer">
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span>Signal — multi-chain launchpad. Early build — nothing deployed to Mainnet yet.</span>
        <span>
          <a href="/security" style={{ color: 'var(--ink-dim)' }}>Security</a> ·{' '}
          <a href="/transparency" style={{ color: 'var(--ink-dim)' }}>Transparency</a>
        </span>
      </div>
    </footer>
  );
}
