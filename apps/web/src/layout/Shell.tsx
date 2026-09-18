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
