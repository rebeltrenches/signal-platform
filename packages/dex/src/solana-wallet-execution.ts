import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { assertSimulationPassed, simulateUnsignedSolanaTrade, type SolanaSimulationResult } from './solana-simulation.js';

export interface SolanaWalletSigner {
  publicKey: PublicKey | null;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
}

export interface SolanaExecutionResult {
  signature: string;
  simulation: SolanaSimulationResult;
}

/**
 * Fail-closed wallet execution boundary.
 *
 * The transaction is simulated before the wallet is ever asked to sign.
 * This helper does not enable any UI; callers must opt in explicitly.
 */
export async function simulateSignAndSendSolanaTrade(params: {
  connection: Connection;
  wallet: SolanaWalletSigner;
  transaction: Transaction | VersionedTransaction;
  commitment?: 'confirmed' | 'finalized';
}): Promise<SolanaExecutionResult> {
  const payer = params.wallet.publicKey;
  if (!payer) throw new Error('Wallet is not connected.');

  const commitment = params.commitment ?? 'confirmed';
  const latest = await params.connection.getLatestBlockhash(commitment);

  // A compiled V0 message cannot safely have its blockhash replaced here.
  // Its assembler must rebuild it with the fresh blockhash before execution.
  if (params.transaction instanceof VersionedTransaction && params.transaction.message.recentBlockhash !== latest.blockhash) {
    throw new Error('Versioned trade must be rebuilt with the latest blockhash before wallet execution.');
  }

  if (params.transaction instanceof Transaction) {
    params.transaction.feePayer = payer;
    params.transaction.recentBlockhash = latest.blockhash;
  }

  const simulation = await simulateUnsignedSolanaTrade({
    connection: params.connection,
    transaction: params.transaction,
    payer,
  });
  assertSimulationPassed(simulation);

  // No wallet approval is requested before the mandatory simulation succeeds.
  const signed = await params.wallet.signTransaction(params.transaction);
  const signature = await params.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  const confirmation = await params.connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    commitment,
  );
  if (confirmation.value.err != null) {
    throw new Error(`Solana trade confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return { signature, simulation };
}


/**
 * Preferred execution path for both legacy and V0 trades. Fetches the fresh
 * blockhash first, then requires the caller's assembler to build against that
 * exact blockhash before simulation/signing/submission.
 */
export async function buildSimulateSignAndSendSolanaTrade(params: {
  connection: Connection;
  wallet: SolanaWalletSigner;
  build: (freshBlockhash: string) => Promise<Transaction | VersionedTransaction>;
  commitment?: 'confirmed' | 'finalized';
}): Promise<SolanaExecutionResult> {
  const payer = params.wallet.publicKey;
  if (!payer) throw new Error('Wallet is not connected.');
  const commitment = params.commitment ?? 'confirmed';
  const latest = await params.connection.getLatestBlockhash(commitment);
  const transaction = await params.build(latest.blockhash);

  if (transaction instanceof Transaction) {
    transaction.feePayer = payer;
    transaction.recentBlockhash = latest.blockhash;
  } else if (transaction.message.recentBlockhash !== latest.blockhash) {
    throw new Error('Versioned trade builder did not use the required fresh blockhash.');
  }

  const simulation = await simulateUnsignedSolanaTrade({ connection: params.connection, transaction, payer });
  assertSimulationPassed(simulation);

  const signed = await params.wallet.signTransaction(transaction);
  const signature = await params.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  const confirmation = await params.connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    commitment,
  );
  if (confirmation.value.err != null) {
    throw new Error(`Solana trade confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return { signature, simulation };
}
