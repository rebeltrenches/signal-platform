/**
 * Per-chain configuration. Adding a chain from the "planned" list means
 * adding one entry here + implementing its adapters — nothing in apps/
 * should ever switch on `chain === 'solana'` directly; it should read
 * from this config or call the adapter registry instead.
 */
import type { Chain, ChainFamily, TaxConfig } from '@launchpad/types';
import { DEFAULT_TAX_CONFIG, DISABLED_TAX_CONFIG } from '@launchpad/types';

export interface ChainConfig {
  chain: Chain;
  family: ChainFamily;
  displayName: string;
  /** Whether a working BlockchainAdapter + DexAdapter exist today. */
  adapterImplemented: boolean;
  /** Whether Signal can discover/display EXISTING tokens on this chain —
   *  master spec section 22: kept deliberately separate from
   *  adapterImplemented (which is about LAUNCHING/deploying), since a
   *  chain like Robinhood is discovery-only for a long time before (if
   *  ever) deployment is added. Requires a real indexer/data source —
   *  Stage 11 — not implemented for any chain yet, including Solana. */
  discoverySupported: boolean;
  /** Whether the transaction-tax mechanism is available on this chain.
   *  Solana: yes, via Token-2022's native TransferFeeConfig extension
   *  (audited, no custom contract). EVM chains: no, until a custom tax
   *  contract is written AND audited — see docs/ARCHITECTURE.md ADR-0003. */
  taxSupported: boolean;
  defaultTaxConfig: TaxConfig;
  nativeCurrencySymbol: string;
  blockExplorerUrl: string;
  isTestnet: boolean;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  solana: {
    chain: 'solana',
    family: 'svm',
    displayName: 'Solana',
    adapterImplemented: false, // becomes true at Stage 6
    discoverySupported: false, // needs Stage 11 (indexer)
    taxSupported: true,
    defaultTaxConfig: DEFAULT_TAX_CONFIG,
    nativeCurrencySymbol: 'SOL',
    blockExplorerUrl: 'https://explorer.solana.com',
    isTestnet: false,
  },
  'solana-devnet': {
    chain: 'solana',
    family: 'svm',
    displayName: 'Solana Devnet',
    adapterImplemented: false,
    discoverySupported: false,
    taxSupported: true,
    defaultTaxConfig: DEFAULT_TAX_CONFIG,
    nativeCurrencySymbol: 'SOL',
    blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
    isTestnet: true,
  },
  base: {
    chain: 'base',
    family: 'evm',
    displayName: 'Base',
    adapterImplemented: false, // becomes true at Stage 7
    discoverySupported: false,
    taxSupported: false, // deferred — see ADR-0003
    defaultTaxConfig: DISABLED_TAX_CONFIG,
    nativeCurrencySymbol: 'ETH',
    blockExplorerUrl: 'https://basescan.org',
    isTestnet: false,
  },
  bnb: {
    chain: 'bnb',
    family: 'evm',
    displayName: 'BNB Chain',
    adapterImplemented: false, // becomes true at Stage 7
    discoverySupported: false,
    taxSupported: false, // deferred — see ADR-0003
    defaultTaxConfig: DISABLED_TAX_CONFIG,
    nativeCurrencySymbol: 'BNB',
    blockExplorerUrl: 'https://bscscan.com',
    isTestnet: false,
  },
  robinhood: {
    chain: 'robinhood',
    family: 'evm',
    displayName: 'Robinhood Chain',
    adapterImplemented: false, // deployment: Coming Soon, no timeline — master spec section 22
    discoverySupported: false, // discovery: the eventual near-term goal, needs a reliable data source first
    taxSupported: false,
    defaultTaxConfig: DISABLED_TAX_CONFIG,
    nativeCurrencySymbol: 'ETH', // Robinhood Chain is an OP Stack L2; confirm before relying on this if it's ever wired up for real
    blockExplorerUrl: '', // no confirmed public explorer URL recorded — left blank rather than guessed
    isTestnet: false,
  },
};

export function getChainConfig(chain: Chain): ChainConfig {
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    throw new Error(`No ChainConfig registered for chain "${chain}". Add one in packages/config/src/chains.ts.`);
  }
  return config;
}

export function listImplementedChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter((c) => c.adapterImplemented);
}
