import React from 'react';
import { SignalMark } from './SignalMark.js';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/explore', label: 'Explore' },
  { href: '/create', label: 'Create' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/community', label: 'Community' },
  { href: '/transparency', label: 'Transparency' },
  { href: '/security', label: 'Security' },
];

/**
 * Server-rendered shell; the mobile drawer toggle and the wallet-connect
 * button are wired up client-side in src/client/nav.ts and
 * src/client/wallet-connect.ts — this component only emits the markup
 * and data attributes those scripts hook into.
 */
export function Header({ currentPath }: { currentPath: string }) {
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <a href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <SignalMark size={28} />
          </span>
          Signal
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} aria-current={currentPath === item.href ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div id="wallet-connect-root" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost" id="wallet-connect-btn" type="button">
            Connect wallet
          </button>
        </div>
        <button className="nav-mobile-toggle" id="nav-mobile-toggle" aria-expanded="false" aria-controls="nav-drawer" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <nav className="nav-drawer" id="nav-drawer" aria-label="Primary, mobile">
        {NAV_ITEMS.map((item) => (
          <a key={item.href} href={item.href} aria-current={currentPath === item.href ? 'page' : undefined}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
