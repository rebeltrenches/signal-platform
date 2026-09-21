import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { WRAPPED_SOL_MINT, deriveSolSellSettlementAccounts } from './sol-sell-accounts.js';

/**
 * Constructs the client-side account layout for the future SELL settlement
 * program. No deployed program address is assumed here.
 */
export function buildSolSellSettlementInstruction(params: {
  programId: string;
  settlementAuthority: string;
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
      { pubkey: accounts.creator, isSigner: false, isWritable: true },
      { pubkey: accounts.trader, isSigner: false, isWritable: true },
      { pubkey: WRAPPED_SOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}
