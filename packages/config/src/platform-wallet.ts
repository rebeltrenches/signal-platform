/** Public SIGNAL treasury: the one place the browser/server platform fee
 *  recipient is configured. The bonding-curve program independently hard-binds
 *  this same public key and enforces the 0.001 SOL launch fee plus the 1% SOL
 *  pre-graduation curve trading fee. Post-graduation/external Signal-routed
 *  trades use this address through the existing settlement path.
 *
 *  Browser scripts read it from /client/platform-wallet.js, which
 *  apps/web/scripts/build.tsx generates from this constant.
 *  Never store a private key here. */
export const SIGNAL_PLATFORM_WALLET_ADDRESS =
  'HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg';

export function getPlatformWalletAddress(): string {
  return SIGNAL_PLATFORM_WALLET_ADDRESS;
}
