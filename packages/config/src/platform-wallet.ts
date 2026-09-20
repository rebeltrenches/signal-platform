/**
 * The Signal platform wallet — the sole recipient of the 1% Signal Fee
 * (see packages/types' TaxConfig/DEFAULT_TAX_CONFIG and
 * docs/ARCHITECTURE.md's fee-model decision history). Configured via
 * SIGNAL_PLATFORM_WALLET, never hardcoded into any adapter or route
 * file directly — this is the one place that reads the env var, so
 * every consumer (SolanaAdapter.ts, apps/api's fee-preview route, the
 * build-time injection for launch-solana.js — see apps/web/scripts/
 * build.tsx) goes through here rather than each having its own copy
 * that could drift.
 *
 * This is a wallet ADDRESS (a public key), not a private key or
 * secret — Signal never holds a key for this wallet any more than for
 * a creator's own wallet (see docs/SECURITY.md's "your keys, your
 * control" section, which this change does not alter: the platform
 * wallet's own holder is responsible for its security exactly as a
 * creator wallet's holder always has been). "Securely configurable"
 * for a public address means "named, overridable env var, not
 * hardcoded in source" — not secrecy, since this address is
 * necessarily visible on-chain in every transfer-fee-bearing
 * transaction regardless of where it's configured.
 *
 * Throws loudly if unset — the same "wrong config is never a quiet
 * surprise" rule as CHAT_STORAGE=database and AUTH_SECRET elsewhere in
 * this project. A launch or a fee-collection silently defaulting to no
 * recipient, or to some other address, would be a real, serious bug —
 * this makes that structurally impossible rather than merely
 * documented.
 */
export function getPlatformWalletAddress(): string {
  const address = process.env.SIGNAL_PLATFORM_WALLET;
  if (!address) {
    throw new Error(
      'SIGNAL_PLATFORM_WALLET is not set. The Signal Fee has no configured recipient — ' +
      'refusing to proceed rather than silently using no address or a wrong one.'
    );
  }
  return address;
}
