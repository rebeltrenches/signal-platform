import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { WRAPPED_SOL_MINT, deriveSolSellSettlementAccounts } from './sol-sell-accounts.js';

export const SETTLE_SELL_INSTRUCTION = 1;

export function buildSolSellSettlementInstruction(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
}): TransactionInstruction {
  const programId = new PublicKey(params.programId);
  const accounts = deriveSolSellSettlementAccounts(params);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.authority, isSigner: false, isWritable: false },
      { pubkey: accounts.settlementWsolAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.creatorWsolAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.traderWsolAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.creator, isSigner: false, isWritable: false },
      { pubkey: accounts.trader, isSigner: true, isWritable: false },
      { pubkey: WRAPPED_SOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([SETTLE_SELL_INSTRUCTION]),
  });
}
