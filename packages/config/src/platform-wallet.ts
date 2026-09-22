/**
 * SIGNAL platform launch-fee recipient.
 *
 * This public address receives SIGNAL's fixed launch fee. Creator trading
 * fees are separate: they belong to each token creator and are settled in
 * native SOL by SIGNAL-routed trades.
 *
 * The address is public on-chain; the private key is never stored here.
 */
export function getPlatformWalletAddress(): string {
  const address = process.env.SIGNAL_PLATFORM_WALLET;
  if (!address) {
    throw new Error(
      'SIGNAL_PLATFORM_WALLET is not set. The launch fee has no configured recipient — ' +
      'refusing to proceed rather than silently using a wrong address.'
    );
  }
  return address;
}
