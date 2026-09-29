/**
 * Stage 4 build script. No bundler was available (no internet in this
 * sandbox), so this does the one thing that's actually needed without
 * one: server-render each real React page component to static HTML via
 * react-dom/server, using globally-available React (no npm install
 * required to run this specific script). CSS and the plain-JS client
 * scripts are copied as-is — they need no build step of their own. The
 * one bundling step is the wallet libraries (src/vendor, see below).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
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
import { TermsPage } from '../src/pages/TermsPage.js';
import { CHAIN_CONFIGS, SIGNAL_PLATFORM_WALLET_ADDRESS } from '@launchpad/config';
import { DEFAULT_TAX_CONFIG } from '@launchpad/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const RESTRICTIONS = JSON.parse(readFileSync(join(ROOT, '..', '..', 'config', 'restrictions.json'), 'utf8'));

interface RouteDef {
  path: string;
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
    clientScripts: ['/client/wizard.js', '/client/auth-client.js'],
    // IMPORTANT: the legacy launch-solana.js minted the complete supply to
    // the creator wallet. It is intentionally no longer loaded. New Signal
    // launches use the program-owned bonding curve flow below.
    moduleScripts: ['/client/launch-solana-curve.js', '/client/evm-wallet.js'],
    embeddedJson: { chainConfigs: CHAIN_CONFIGS, defaultTaxConfig: DEFAULT_TAX_CONFIG },
  },
  { path: 'explore', title: 'Explore', element: <ExplorePage />, clientScripts: ['/client/logo-image.js', '/client/explore.js'] },
  {
    path: 'token/example',
    title: 'Token',
    element: <TokenDetailPage />,
    clientScripts: ['/client/logo-image.js', '/client/token-detail.js', '/client/auth-client.js', '/client/chat.js'],
    // trade-router.js detects a live Signal bonding curve first. Only tokens
    // without an active Signal curve fall through to the existing Jupiter
    // execution module. This prevents a newly launched curve token from being
    // sent to an external router before graduation.
    moduleScripts: ['/client/trade-router.js'],
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
  { path: 'terms', title: 'Terms and risks', element: <TermsPage restrictions={RESTRICTIONS} /> },
];

function currentPathFor(routePath: string): string {
  return routePath === '' ? '/' : `/${routePath}`;
}

function build() {
  mkdirSync(DIST, { recursive: true });

  const apiBaseUrl = process.env.SIGNAL_API_BASE_URL || undefined;
  const solanaCluster = process.env.SIGNAL_SOLANA_CLUSTER === 'devnet' ? 'devnet' as const : undefined;
  if (solanaCluster) console.log('  SIGNAL_SOLANA_CLUSTER=devnet — DEVNET TEST BUILD, do not deploy');

  for (const route of routes) {
    const html =
      '<!DOCTYPE html>\n' +
      renderToStaticMarkup(
        <Shell
          currentPath={currentPathFor(route.path)}
          title={route.title}
          clientScripts={['/client/nav.js', '/client/compliance.js', '/client/wallet-connect.js', ...(route.clientScripts ?? [])]}
          termsVersion={RESTRICTIONS.termsVersion}
          moduleScripts={route.moduleScripts ?? []}
          embeddedJson={route.embeddedJson}
          apiBaseUrl={apiBaseUrl}
          solanaCluster={solanaCluster}
        >
          {route.element}
        </Shell>
      );

    const outDir = route.path === '' ? DIST : join(DIST, route.path);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), html, 'utf8');
    console.log(`  built /${route.path}`);
  }

  const stylesOut = join(DIST, 'styles');
  mkdirSync(stylesOut, { recursive: true });
  const stylesSrc = join(ROOT, 'src', 'styles');
  for (const file of readdirSync(stylesSrc)) copyFileSync(join(stylesSrc, file), join(stylesOut, file));

  const clientOut = join(DIST, 'client');
  mkdirSync(clientOut, { recursive: true });
  const clientSrc = join(ROOT, 'src', 'client');
  for (const file of readdirSync(clientSrc)) copyFileSync(join(clientSrc, file), join(clientOut, file));

  writeFileSync(
    join(clientOut, 'platform-wallet.js'),
    '// Generated by apps/web/scripts/build.tsx from packages/config/src/platform-wallet.ts.\n' +
      '// Do not edit: change the address there.\n' +
      `export const SIGNAL_PLATFORM_WALLET_ADDRESS = ${JSON.stringify(SIGNAL_PLATFORM_WALLET_ADDRESS)};\n`,
    'utf8'
  );

  // A bonding-curve program ID must be supplied by the environment that
  // builds a deployable site. An empty ID deliberately disables token
  // launch rather than falling back to the old all-supply-to-creator flow.
  const bondingCurveProgramId = process.env.SIGNAL_BONDING_CURVE_PROGRAM_ID || '';
  writeFileSync(
    join(clientOut, 'bonding-curve-program.js'),
    '// Generated by apps/web/scripts/build.tsx.\n' +
      '// Empty means launching is intentionally disabled until the audited program is deployed.\n' +
      `export const SIGNAL_BONDING_CURVE_PROGRAM_ID = ${JSON.stringify(bondingCurveProgramId)};\n`,
    'utf8'
  );

  const vendorOut = join(clientOut, 'vendor');
  rmSync(vendorOut, { recursive: true, force: true });
  buildSync({
    entryPoints: {
      'solana-web3': join(ROOT, 'src', 'vendor', 'solana-web3.js'),
      'spl-token': join(ROOT, 'src', 'vendor', 'spl-token.js'),
    },
    outdir: vendorOut,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    chunkNames: 'chunks/[name]-[hash]',
    inject: [join(ROOT, 'src', 'vendor', 'buffer-shim.js')],
    logLevel: 'warning',
  });

  const assetsOut = join(DIST, 'assets');
  mkdirSync(assetsOut, { recursive: true });
  const assetsSrc = join(ROOT, 'src', 'assets');
  for (const file of readdirSync(assetsSrc)) copyFileSync(join(assetsSrc, file), join(assetsOut, file));

  console.log(`\nBuilt ${routes.length} pages + styles + client scripts + assets to ${DIST}`);
}

build();