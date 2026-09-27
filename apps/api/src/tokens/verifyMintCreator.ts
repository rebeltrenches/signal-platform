/**
 * On-chain proof that a wallet created a Solana SPL Token mint — the
 * check that makes a registration's creatorWalletAddress a verified
 * fact instead of whatever the client claimed (audit item C2).
 *
 * "Created" means: the mint's creation transaction (the one successful
 * initializeMint for it) set this wallet as the initial mint authority
 * AND was signed by this wallet. The CURRENT mint authority can't be
 * used as proof, because every Signal launch revokes it (C3) before
 * registering.
 *
 * Reads the chain through a plain JSON-RPC call function so tests can
 * substitute a fake; solanaRpcFromEnv() is the real one. Two distinct
 * failure types, because they mean different things to the caller:
 *  - MintOwnershipError: the chain answered, and it does not prove
 *    this wallet created this mint (or the mint doesn't exist).
 *  - MintVerificationUnavailableError: the chain couldn't be asked or
 *    couldn't give a complete answer. Registration fails closed.
 */
import { base58Decode } from '../chat/verify.js';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SIGNATURE_PAGE_SIZE = 1000;
const MAX_SIGNATURE_PAGES = 5;
// A mint's creation is its first successful transaction; this many of
// the oldest are checked in case something else touched the address first.
const MAX_CREATION_CANDIDATES = 10;
const RPC_TIMEOUT_MS = 15_000;

export class MintOwnershipError extends Error {}
export class MintVerificationUnavailableError extends Error {}

export type SolanaRpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/** A 32-byte base58 value — the shape of every Solana address. */
export function isSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}

/** JSON-RPC over the endpoint in SOLANA_RPC_URL, or null if it isn't
 *  configured. https only, except plain http to this machine (tests and
 *  local Devnet runs against a local fake or proxy). */
export function solanaRpcFromEnv(): SolanaRpcCall | null {
  const url = process.env.SOLANA_RPC_URL ?? '';
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
  if (!url.startsWith('https://') && !isLocal) return null;
  return async (method, params) => {
    let payload: any;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      payload = response.ok ? await response.json() : null;
    } catch {
      payload = null;
    }
    if (!payload || payload.error || !('result' in payload)) {
      throw new MintVerificationUnavailableError(`Solana RPC ${method} failed${payload?.error?.message ? `: ${payload.error.message}` : ''}.`);
    }
    return payload.result;
  };
}

interface ParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: { mint?: string; mintAuthority?: string | null } };
}

function findInitializeMint(tx: any, mint: string): ParsedInstruction['parsed'] | null {
  const instructions: ParsedInstruction[] = [
    ...(tx?.transaction?.message?.instructions ?? []),
    ...((tx?.meta?.innerInstructions ?? []).flatMap((inner: any) => inner?.instructions ?? [])),
  ];
  for (const ix of instructions) {
    const type = ix.parsed?.type;
    if (ix.programId === SPL_TOKEN_PROGRAM_ID && (type === 'initializeMint' || type === 'initializeMint2') && ix.parsed?.info?.mint === mint) {
      return ix.parsed;
    }
  }
  return null;
}

/** Resolves if `wallet` created `mint` with `decimals`; throws otherwise. */
export async function verifySolanaMintCreator(rpc: SolanaRpcCall, mint: string, wallet: string, decimals: number): Promise<void> {
  const account: any = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const value = account?.value;
  if (!value) throw new MintOwnershipError('No mint exists at this address on-chain.');
  if (value.owner !== SPL_TOKEN_PROGRAM_ID || value.data?.parsed?.type !== 'mint' || !value.data.parsed.info?.isInitialized) {
    throw new MintOwnershipError('This address is not an SPL Token mint.');
  }
  if (value.data.parsed.info.decimals !== decimals) {
    throw new MintOwnershipError(`On-chain decimals are ${value.data.parsed.info.decimals}, not ${decimals}.`);
  }

  // getSignaturesForAddress is newest-first; page back to the oldest.
  let oldestPage: Array<{ signature: string; err: unknown }> = [];
  let before: string | undefined;
  for (let page = 0; ; page += 1) {
    const signatures = await rpc('getSignaturesForAddress', [mint, { limit: SIGNATURE_PAGE_SIZE, before, commitment: 'confirmed' }]);
    if (!Array.isArray(signatures)) throw new MintVerificationUnavailableError('Solana RPC returned no signature history.');
    if (signatures.length > 0) oldestPage = signatures;
    if (signatures.length < SIGNATURE_PAGE_SIZE) break;
    if (page + 1 >= MAX_SIGNATURE_PAGES) {
      throw new MintVerificationUnavailableError('This mint has too much history to find its creation transaction.');
    }
    before = signatures[signatures.length - 1]!.signature;
  }

  const candidates = oldestPage.slice(-MAX_CREATION_CANDIDATES).reverse().filter((s) => s.err === null);
  for (const candidate of candidates) {
    const tx: any = await rpc('getTransaction', [
      candidate.signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx || tx.meta?.err) continue;
    const init = findInitializeMint(tx, mint);
    if (!init) continue;
    // Only one initializeMint can ever succeed for a mint: this is its creation.
    const signers: string[] = (tx.transaction?.message?.accountKeys ?? [])
      .filter((key: any) => key?.signer)
      .map((key: any) => key.pubkey);
    if (init.info?.mintAuthority === wallet && signers.includes(wallet)) return;
    throw new MintOwnershipError('This wallet did not create this mint.');
  }
  throw new MintVerificationUnavailableError("Could not find this mint's creation transaction.");
}
