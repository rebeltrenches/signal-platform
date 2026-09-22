/** Public SIGNAL launch-fee recipient. Never store a private key here. */
export const SIGNAL_PLATFORM_WALLET_ADDRESS =
  'FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19';

export function getPlatformWalletAddress(): string {
  return SIGNAL_PLATFORM_WALLET_ADDRESS;
}
