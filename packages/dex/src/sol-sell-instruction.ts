import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { WRAPPED_SOL_MINT, deriveSolSellSettlementAccounts, parseTradeId } from './sol-sell-accounts.js';

export const SETTLE_SELL_INSTRUCTION = 1;

/**
 * Must be placed before the Raydium SELL in the SAME transaction.
 * This is deliberately non-idempotent: if the trade-specific settlement ATA
 * already exists, creation fails and the entire transaction fails closed.
 */
export function buildCreateSolSellSettlementAccountInstruction(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
}): TransactionInstruction {
  const accounts = deriveSolSellSettlementAccounts(params);
  return createAssociatedTokenAccountInstruction(
    accounts.trader,
    accounts.settlementWsolAccount,
    accounts.authority,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
  );
}

/**
 * Must be placed after the Raydium SELL in the SAME transaction.
 * The on-chain program closes the trade-specific native WSOL account,
 * pays the creator 1% in native SOL, pays the trader 99% in native SOL,
 * and returns the temporary account rent to the trader.
 */
export function buildSolSellSettlementInstruction(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
}): TransactionInstruction {
  const programId = new PublicKey(params.programId);
  const accounts = deriveSolSellSettlementAccounts(params);
  const tradeId = parseTradeId(params.tradeId);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.authority, isSigner: false, isWritable: true },
      { pubkey: accounts.settlementWsolAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.creator, isSigner: false, isWritable: true },
      { pubkey: accounts.trader, isSigner: true, isWritable: true },
      { pubkey: WRAPPED_SOL_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([SETTLE_SELL_INSTRUCTION]), tradeId]),
  });
}
