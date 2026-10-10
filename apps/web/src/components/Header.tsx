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
    <header className={currentPath === '/' ? 'topbar topbar-home' : 'topbar'}>
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
        <a
          href="https://x.com/SignalChainpad"
          className="btn btn-ghost header-social"
          aria-label="Signal on X"
          title="Signal on X"
          target="_blank"
          rel="noopener noreferrer"
          style={{ width: 38, padding: 0, marginLeft: 'auto', fontWeight: 700, fontSize: 16 }}
        >
          𝕏
        </a>
        <a
          href="https://t.me/+1wKw0JsTmzkwZWE0"
          className="btn btn-ghost header-social"
          aria-label="Signal on Telegram"
          title="Join Signal on Telegram"
          target="_blank"
          rel="noopener noreferrer"
          style={{ width: 38, padding: 0, fontWeight: 800, fontSize: 13 }}
        >
          TG
        </a>
        {currentPath === '/' && (
          <a href="/support" className="btn btn-ghost" aria-label="Signal Support" title="Log a support ticket"
            style={{ width: 38, height: 38, padding: 0, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 13v-2a8 8 0 0116 0v2M4 12H3v6h4v-6H4zm16 0h1v6h-4v-6h3zm0 6v1a3 3 0 01-3 3h-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        )}
        <div id="wallet-connect-root">
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
        <a href="/profile" aria-current={currentPath === '/profile' ? 'page' : undefined}>My profile</a>
        <a href="https://x.com/SignalChainpad" target="_blank" rel="noopener noreferrer">Signal on X ↗</a>
        <a href="https://t.me/+1wKw0JsTmzkwZWE0" target="_blank" rel="noopener noreferrer">Join Telegram ↗</a>
        {currentPath === '/' && <a href="/support">Support · Log a ticket</a>}
      </nav>
    </header>
  );
}
