import React from 'react';
import { Header } from '../components/Header.js';
import { Footer } from '../components/Footer.js';

export function Shell({
  currentPath,
  title,
  children,
  clientScripts = [],
  moduleScripts = [],
  embeddedJson,
  apiBaseUrl,
  platformWalletAddress,
}: {
  currentPath: string;
  title: string;
  children: React.ReactNode;
  clientScripts?: string[];
  /** Scripts needing `type="module"` — i.e. ones using `import` statements
   *  (esm.sh CDN imports for @solana/web3.js etc., since no bundler is
   *  available offline to pre-bundle them). Separate from clientScripts
   *  because a plain classic <script> can't contain `import`. */
  moduleScripts?: string[];
  /** Real, static, build-time config data (e.g. CHAIN_CONFIGS) embedded
   *  for client scripts to read — never per-user or sensitive data,
   *  never a substitute for the real API once Stage 19 auth exists. */
  embeddedJson?: Record<string, unknown>;
  /** When apps/api is hosted separately from this static site, set at
   *  build time from the SIGNAL_API_BASE_URL env var (see build.tsx).
   *  Undefined (the default, and the only way this has ever actually
   *  run) omits the script entirely — chat.js's own apiUrl() helper
   *  then uses today's exact relative-path, same-origin behavior. */
  apiBaseUrl?: string;
  /** The Signal platform wallet's PUBLIC address — the sole recipient
   *  of the Signal Fee (see packages/config/src/platform-wallet.ts).
   *  Set at build time from SIGNAL_PLATFORM_WALLET so launch-solana.js
   *  never has this hardcoded in its own source. Not a secret (a
   *  wallet address is necessarily visible on-chain in every fee-
   *  bearing transaction regardless), but still configured rather than
   *  hardcoded so it can be changed without touching client code. */
  platformWalletAddress?: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} — Signal`}</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon-64.png" />
        <link rel="stylesheet" href="/styles/tokens.css" />
        <link rel="stylesheet" href="/styles/base.css" />
        <link rel="stylesheet" href="/styles/components.css" />
        {(apiBaseUrl || platformWalletAddress) && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                (apiBaseUrl ? `window.SIGNAL_API_BASE_URL=${JSON.stringify(apiBaseUrl)};` : '') +
                (platformWalletAddress ? `window.SIGNAL_PLATFORM_WALLET=${JSON.stringify(platformWalletAddress)};` : ''),
            }}
          />
        )}
      </head>
      <body>
        <Header currentPath={currentPath} />
        <main>{children}</main>
        <Footer />
        {embeddedJson && (
          <script
            type="application/json"
            id="embedded-data"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(embeddedJson) }}
          />
        )}
        {clientScripts.map((src) => (
          <script key={src} src={src} defer />
        ))}
        {moduleScripts.map((src) => (
          <script key={src} type="module" src={src} />
        ))}
      </body>
    </html>
  );
}
