import { SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { prepareSolBuySettlement } from './amm-math.js';

export interface SolBuyAssembly {
  grossSolLamports: bigint;
  creatorFeeLamports: bigint;
  raydiumInputLamports: bigint;
  transaction: Transaction | VersionedTransaction;
}

/**
 * Build the atomic BUY transaction boundary for SIGNAL.
 *
 * The buyer signs one transaction containing both:
 *  1) the 1% SOL payment to the token creator; and
 *  2) the Raydium swap instructions using the remaining 99% SOL.
 *
 * Nothing is signed or submitted here.
 */
export function assembleSolBuyTransaction(params: {
  buyerAddress: string;
  creatorAddress: string;
  grossSolLamports: bigint;
  raydiumTransaction: Transaction | VersionedTransaction;
}): SolBuyAssembly {
  const buyer = new PublicKey(params.buyerAddress);
  const creator = new PublicKey(params.creatorAddress);
  if (buyer.equals(creator)) {
    throw new Error('Buyer and token creator addresses must be handled explicitly before fee settlement.');
  }

  const settlement = prepareSolBuySettlement(params.grossSolLamports);
  if (settlement.creatorFeeLamports <= 0n) {
    throw new Error('Trade amount is too small to produce a creator fee in lamports.');
  }
  if (settlement.creatorFeeLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Creator fee exceeds safe SystemProgram transfer range.');
  }

  const feeInstruction = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: creator,
    lamports: Number(settlement.creatorFeeLamports),
  });

  if (params.raydiumTransaction instanceof Transaction) {
    const tx = new Transaction();
    tx.feePayer = buyer;
    tx.add(feeInstruction, ...params.raydiumTransaction.instructions);
    return { ...settlement, transaction: tx };
  }

  // A v0 Raydium transaction cannot be safely spliced without its
  // address-lookup-table accounts. Fail closed until the SDK bridge
  // returns the lookup tables required to recompile the message.
  if (params.raydiumTransaction instanceof VersionedTransaction) {
    throw new Error('Versioned Raydium BUY requires lookup-table-aware recompilation before creator fee insertion.');
  }

  throw new TypeError('Unsupported Raydium transaction type.');
}
