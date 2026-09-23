/**
 * Stage 4 build script. No bundler was available (no internet in this
 * sandbox), so this does the one thing that's actually needed without
 * one: server-render each real React page component to static HTML via
 * react-dom/server, using globally-available React (no npm install
 * required to run this specific script). CSS and the plain-JS client
 * scripts are copied as-is — they need no build step of their own.
 *
 * Migrating to real Next.js later: these same page components become
 * Next's page/route components close to verbatim — the App Router's
 * server components render the same way this script does. The routing
 * table below becomes Next's file-based routing instead of this array.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Shell } from '../src/layout/Shell.js';
import { HomePage } from '../src/pages/HomePage.js';
import { CreatePage } from '../src/pages/CreatePage.js';
import { ExplorePage } from '../src/pages/ExplorePage.js';
import { TokenDetailPage } from '../src/pages/TokenDetailPage.js';
import { WalletDetailPage } from '../src/pages/WalletDetailPage.js';
import { DashboardPage } from '../src/pages/DashboardPage.js';
import { SecurityPage } from '../src/pages/SecurityPage.js';
import { TransparencyPage } from '../src/pages/TransparencyPage.js';
import { CommunityPage } from '../src/pages/CommunityPage.js';
import { CHAIN_CONFIGS } from '@launchpad/config';
import { DEFAULT_TAX_CONFIG } from '@launchpad/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

interface RouteDef {
  path: string; // output path under dist/, e.g. '' for home, 'create' for /create
  title: string;
  element: React.ReactElement;
  clientScripts?: string[];
  moduleScripts?: string[];
  embeddedJson?: Record<string, unknown>;
}

const routes: RouteDef[] = [
  { path: '', title: 'Home', element: <HomePage /> },
  {
    path: 'create',
    title: 'Create',
    element: <CreatePage />,
    clientScripts: ['/client/wizard.js'],
    moduleScripts: ['/client/launch-solana.js', '/client/evm-wallet.js'],
    embeddedJson: { chainConfigs: CHAIN_CONFIGS, defaultTaxConfig: DEFAULT_TAX_CONFIG },
  },
  { path: 'explore', title: 'Explore', element: <ExplorePage />, clientScripts: ['/client/explore.js'] },
  {
    path: 'token/example',
    title: 'Token',
    element: <TokenDetailPage />,
    clientScripts: ['/client/token-detail.js', '/client/auth-client.js', '/client/chat.js'],
    moduleScripts: ['/client/swap-execute.js?v=swap-rpc-url-1'],
  },
  { path: 'wallet/example', title: 'Wallet', element: <WalletDetailPage />, clientScripts: ['/client/wallet-detail.js'] },
  {
    path: 'dashboard',
    title: 'Dashboard',
    element: <DashboardPage />,
    clientScripts: ['/client/dashboard.js', '/client/auth-client.js', '/client/watchlist.js', '/client/alerts.js'],
    moduleScripts: ['/client/portfolio.js?v=stage3-portfolio-4'],
  },
  { path: 'security', title: 'Security', element: <SecurityPage /> },
  { path: 'transparency', title: 'Transparency', element: <TransparencyPage /> },
  { path: 'community', title: 'Community', element: <CommunityPage />, clientScripts: ['/client/auth-client.js', '/client/chat.js'] },
];

function currentPathFor(routePath: string): string {
  return routePath === '' ? '/' : `/${routePath}`;
}

function build() {
  mkdirSync(DIST, { recursive: true });

  // Build-time only, and optional: when apps/api is hosted separately
  // from this static site, set SIGNAL_API_BASE_URL for that build.
  // Unset (the normal case today) means every page omits the script
  // entirely — zero effect on local dev or on any build done without it.
  const apiBaseUrl = process.env.SIGNAL_API_BASE_URL || undefined;

  for (const route of routes) {
    const html =
      '<!DOCTYPE html>\n' +
      renderToStaticMarkup(
        <Shell
          currentPath={currentPathFor(route.path)}
          title={route.title}
          clientScripts={['/client/nav.js', '/client/wallet-connect.js', ...(route.clientScripts ?? [])]}
          moduleScripts={route.moduleScripts ?? []}
          embeddedJson={route.embeddedJson}
          apiBaseUrl={apiBaseUrl}
        >
          {route.element}
        </Shell>
      );

    const outDir = route.path === '' ? DIST : join(DIST, route.path);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), html, 'utf8');
    console.log(`  built /${route.path}`);
  }

  // Copy styles + client scripts as-is.
  const stylesOut = join(DIST, 'styles');
  mkdirSync(stylesOut, { recursive: true });
  const stylesSrc = join(ROOT, 'src', 'styles');
  for (const file of readdirSync(stylesSrc)) {
    copyFileSync(join(stylesSrc, file), join(stylesOut, file));
  }

  const clientOut = join(DIST, 'client');
  mkdirSync(clientOut, { recursive: true });
  const clientSrc = join(ROOT, 'src', 'client');
  for (const file of readdirSync(clientSrc)) {
    copyFileSync(join(clientSrc, file), join(clientOut, file));
  }

  const assetsOut = join(DIST, 'assets');
  mkdirSync(assetsOut, { recursive: true });
  const assetsSrc = join(ROOT, 'src', 'assets');
  for (const file of readdirSync(assetsSrc)) {
    copyFileSync(join(assetsSrc, file), join(assetsOut, file));
  }

  console.log(`\nBuilt ${routes.length} pages + styles + client scripts + assets to ${DIST}`);
}

build();
