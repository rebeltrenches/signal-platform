import React from 'react';
import type { ChainConfig } from '@launchpad/config';

const CHAIN_COLOR_VAR: Record<string, string> = {
  solana: 'var(--chain-solana)',
  base: 'var(--chain-base)',
  bnb: 'var(--chain-bnb)',
};

export function ChainDot({ chain }: { chain: string }) {
  return <span className="chain-dot" style={{ background: CHAIN_COLOR_VAR[chain] ?? 'var(--ink-faint)' }} />;
}

/** Shown wherever a chain needs identifying — never invents data about the
 *  chain beyond its own static config (name, family, whether tax/adapter
 *  are implemented yet). */
export function ChainLabel({ config }: { config: ChainConfig }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <ChainDot chain={config.chain} />
      {config.displayName}
      {config.isTestnet && <span className="badge badge-testnet" style={{ marginLeft: 8 }}>Testnet</span>}
    </span>
  );
}
