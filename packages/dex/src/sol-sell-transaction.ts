import {
  AddressLookupTableAccount,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  buildCreateSolSellSettlementAccountInstruction,
  buildSolSellSettlementInstruction,
} from './sol-sell-instruction.js';
import { deriveSolSellSettlementAccounts } from './sol-sell-accounts.js';

export interface AtomicSolSellAssembly {
  transaction: Transaction | VersionedTransaction;
  settlementWsolAccount: PublicKey;
}

/**
 * Atomic SELL composition boundary:
 *   create fresh trade ATA -> Raydium SELL -> unwrap/split/close.
 *
 * The supplied Raydium transaction MUST already route WSOL output to the
 * trade-specific settlement account. We verify that account is present and
 * writable before composing. Nothing is signed or submitted here.
 */
export function assembleAtomicSolSellTransaction(params: {
  programId: string;
  creatorAddress: string;
  traderAddress: string;
  tradeId: string;
  raydiumTransaction: Transaction | VersionedTransaction;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
}): AtomicSolSellAssembly {
  const accounts = deriveSolSellSettlementAccounts(params);
  const create = buildCreateSolSellSettlementAccountInstruction(params);
  const settle = buildSolSellSettlementInstruction(params);
  const trader = accounts.trader;

  if (params.raydiumTransaction instanceof Transaction) {
    const usesSettlement = params.raydiumTransaction.instructions.some(ix =>
      ix.keys.some(k => k.pubkey.equals(accounts.settlementWsolAccount) && k.isWritable)
    );
    if (!usesSettlement) throw new Error('Raydium SELL is not routed to the trade-specific WSOL settlement account.');
    const tx = new Transaction();
    tx.feePayer = trader;
    tx.add(create, ...params.raydiumTransaction.instructions, settle);
    return { transaction: tx, settlementWsolAccount: accounts.settlementWsolAccount };
  }

  const lookups = params.addressLookupTableAccounts ?? [];
  if (lookups.length !== params.raydiumTransaction.message.addressTableLookups.length) {
    throw new Error('Versioned Raydium SELL is missing required address lookup table accounts.');
  }
  for (let i = 0; i < lookups.length; i++) {
    if (!lookups[i]!.key.equals(params.raydiumTransaction.message.addressTableLookups[i]!.accountKey)) {
      throw new Error('Versioned Raydium SELL address lookup table order/key mismatch.');
    }
  }
  const decoded = TransactionMessage.decompile(params.raydiumTransaction.message, { addressLookupTableAccounts: lookups });
  const usesSettlement = decoded.instructions.some(ix =>
    ix.keys.some(k => k.pubkey.equals(accounts.settlementWsolAccount) && k.isWritable)
  );
  if (!usesSettlement) throw new Error('Raydium SELL is not routed to the trade-specific WSOL settlement account.');

  const message = new TransactionMessage({
    payerKey: trader,
    recentBlockhash: decoded.recentBlockhash,
    instructions: [create, ...decoded.instructions, settle],
  }).compileToV0Message(lookups);

  return { transaction: new VersionedTransaction(message), settlementWsolAccount: accounts.settlementWsolAccount };
}
