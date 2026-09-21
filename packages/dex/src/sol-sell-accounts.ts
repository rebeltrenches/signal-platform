import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export interface SolSellSettlementAccounts {
  authority: PublicKey;
  settlementWsolAccount: PublicKey;
  creator: PublicKey;
  trader: PublicKey;
}

/**
 * Account boundary for the future atomic SELL settlement instruction.
 *
 * Raydium must send WSOL to a settlement account controlled by SIGNAL's
 * on-chain settlement authority. The program then measures the actual
 * received WSOL delta and splits that amount 1% to creator / 99% to trader.
 *
 * This helper derives/validates accounts only. It does not claim an on-chain
 * program exists and cannot enable SELL execution by itself.
 */
export function deriveSolSellSettlementAccounts(params: {
  settlementAuthority: string;
  creatorAddress: string;
  traderAddress: string;
}): SolSellSettlementAccounts {
  const authority = new PublicKey(params.settlementAuthority);
  const creator = new PublicKey(params.creatorAddress);
  const trader = new PublicKey(params.traderAddress);

  if (creator.equals(trader)) {
    throw new Error('Creator and trader must be handled explicitly before SELL settlement.');
  }

  const settlementWsolAccount = getAssociatedTokenAddressSync(
    WRAPPED_SOL_MINT,
    authority,
    true,
    TOKEN_PROGRAM_ID,
  );

  return { authority, settlementWsolAccount, creator, trader };
}
