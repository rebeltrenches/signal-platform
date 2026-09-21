import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const SELL_SETTLEMENT_SEED = Buffer.from('sell-settlement');

export interface SolSellSettlementAccounts {
  authority: PublicKey;
  settlementWsolAccount: PublicKey;
  creator: PublicKey;
  trader: PublicKey;
  creatorWsolAccount: PublicKey;
  traderWsolAccount: PublicKey;
}

export function deriveSolSellSettlementAccounts(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
}): SolSellSettlementAccounts {
  const programId = new PublicKey(params.programId);
  const creator = new PublicKey(params.creatorAddress);
  const trader = new PublicKey(params.traderAddress);

  if (creator.equals(trader)) {
    throw new Error('Creator and trader must be handled explicitly before SELL settlement.');
  }

  const [authority] = PublicKey.findProgramAddressSync([SELL_SETTLEMENT_SEED], programId);
  const settlementWsolAccount = getAssociatedTokenAddressSync(
    WRAPPED_SOL_MINT, authority, true, TOKEN_PROGRAM_ID,
  );
  const creatorWsolAccount = getAssociatedTokenAddressSync(
    WRAPPED_SOL_MINT, creator, false, TOKEN_PROGRAM_ID,
  );
  const traderWsolAccount = getAssociatedTokenAddressSync(
    WRAPPED_SOL_MINT, trader, false, TOKEN_PROGRAM_ID,
  );

  return { authority, settlementWsolAccount, creator, trader, creatorWsolAccount, traderWsolAccount };
}
