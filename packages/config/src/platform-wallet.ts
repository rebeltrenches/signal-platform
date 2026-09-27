/** Public SIGNAL treasury: the one place the platform fee recipient is
 *  set. It receives the 0.001 SOL launch fee (launch-solana.js,
 *  SolanaAdapter.ts) and the 1% SOL swap fee (swap-execute.js). The
 *  browser scripts read it from /client/platform-wallet.js, which
 *  apps/web/scripts/build.tsx generates from this constant.
 *  Never store a private key here. */
export const SIGNAL_PLATFORM_WALLET_ADDRESS =
  'HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg';

export function getPlatformWalletAddress(): string {
  return SIGNAL_PLATFORM_WALLET_ADDRESS;
}
