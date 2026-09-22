import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const SELL_SETTLEMENT_SEED = Buffer.from('sell-settlement');
export const SELL_RECEIPT_SEED = Buffer.from('sell-receipt');

export function parseTradeId(tradeId: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(tradeId)) throw new Error('tradeId must be exactly 32 bytes encoded as 64 hex characters.');
  return Buffer.from(tradeId, 'hex');
}

export interface SolSellSettlementAccounts {
  authority: PublicKey;
  settlementWsolAccount: PublicKey;
  receipt: PublicKey;
  creator: PublicKey;
  trader: PublicKey;
}

export function deriveSolSellSettlementAccounts(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
}): SolSellSettlementAccounts {
  const programId = new PublicKey(params.programId);
  const creator = new PublicKey(params.creatorAddress);
  const trader = new PublicKey(params.traderAddress);
  const tradeId = parseTradeId(params.tradeId);

  if (creator.equals(trader)) throw new Error('Creator and trader must be handled explicitly before SELL settlement.');

  const [authority] = PublicKey.findProgramAddressSync(
    [SELL_SETTLEMENT_SEED, trader.toBuffer(), creator.toBuffer(), tradeId],
    programId,
  );
  const settlementWsolAccount = getAssociatedTokenAddressSync(WRAPPED_SOL_MINT, authority, true, TOKEN_PROGRAM_ID);
  const [receipt] = PublicKey.findProgramAddressSync(
    [SELL_RECEIPT_SEED, trader.toBuffer(), creator.toBuffer(), tradeId],
    programId,
  );
  return { authority, settlementWsolAccount, receipt, creator, trader };
}
