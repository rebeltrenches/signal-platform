import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export interface SolanaSimulationResult {
  ok: boolean;
  unitsConsumed: number | null;
  logs: string[];
  error: unknown;
}

/**
 * Adds a fresh blockhash/payer where possible and simulates without submitting.
 * This is the mandatory gate before SIGNAL signs or sends a built trade.
 */
export async function simulateUnsignedSolanaTrade(params: {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
  payer: PublicKey;
  preserveBlockhash?: boolean;
}): Promise<SolanaSimulationResult> {
  const blockhash = params.preserveBlockhash ? null : (await params.connection.getLatestBlockhash('confirmed')).blockhash;

  if (params.transaction instanceof Transaction) {
    params.transaction.feePayer = params.payer;
    if (blockhash) params.transaction.recentBlockhash = blockhash;
    const result = await params.connection.simulateTransaction(params.transaction);
    return {
      ok: result.value.err == null,
      unitsConsumed: result.value.unitsConsumed ?? null,
      logs: result.value.logs ?? [],
      error: result.value.err,
    };
  }

  // Versioned transactions must be rebuilt with the fresh blockhash by their
  // assembler before signing. Never mutate a compiled message here.
  const result = await params.connection.simulateTransaction(params.transaction, {
    sigVerify: false,
    replaceRecentBlockhash: !params.preserveBlockhash,
  });
  return {
    ok: result.value.err == null,
    unitsConsumed: result.value.unitsConsumed ?? null,
    logs: result.value.logs ?? [],
    error: result.value.err,
  };
}

export function assertSimulationPassed(result: SolanaSimulationResult): void {
  if (!result.ok) {
    const tail = result.logs.slice(-8).join('\n');
    throw new Error(`Solana trade simulation failed: ${JSON.stringify(result.error)}${tail ? `\n${tail}` : ''}`);
  }
}

/** Build then simulate an unsigned trade and fail closed before any signing/submission. */
export async function requireSolanaTradeSimulation<T extends { transaction: Transaction | VersionedTransaction }>(params: {
  connection: Connection;
  payer: PublicKey;
  build: () => Promise<T>;
}): Promise<T & { simulation: SolanaSimulationResult }> {
  const built = await params.build();
  const simulation = await simulateUnsignedSolanaTrade({ connection: params.connection, transaction: built.transaction, payer: params.payer });
  assertSimulationPassed(simulation);
  return { ...built, simulation };
}
