/**
 * Real Ed25519 signature verification using ONLY Node's built-in `crypto`
 * module — zero external dependencies, matching apps/api's existing
 * dependency-free design (see router.ts's own header comment for why
 * that constraint exists: no internet in this sandbox to npm-install a
 * framework or a crypto library).
 *
 * WHY THIS EXISTS: every other "wallet identity" check in this codebase
 * (e.g. collect-fees.js's creator-address match) trusts whatever address
 * the client claims is connected — fine there, because the real security
 * boundary is the blockchain itself (a client can *claim* to be a
 * creator, but can't forge the on-chain authority check). Chat has no
 * such backstop: if posting just meant "send a wallet address string,"
 * anyone could post AS any address with zero proof. So chat messages
 * require a real signature, proving the poster actually holds the
 * private key for the address they claim — using the exact signing
 * primitive Solana wallets already expose for this (`signMessage`,
 * distinct from transaction signing: no SOL cost, no on-chain footprint,
 * just a proof-of-key-ownership signature).
 *
 * Solana public keys ARE Ed25519 keys, base58-encoded. This module
 * accepts the raw 32-byte key (after base58 decoding) and wraps it in
 * the standard RFC 8410 SPKI DER header so Node's `crypto.verify` can
 * consume it — proven to work end-to-end (positive case, tampered
 * message, wrong signer) before this file was written; see the
 * commit message / PR description for that verification.
 */
import crypto from 'node:crypto';

// RFC 8410 SPKI DER prefix for a raw Ed25519 public key. Fixed, standard,
// the same 12 bytes for every Ed25519 key — not something to configure.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal, dependency-free base58 decoder — the same alphabet Solana
 *  addresses and signatures use. No external bs58 package (none is
 *  installable here; this is small enough to own directly and is
 *  exercised by this file's own tests). */
export function base58Decode(input: string): Buffer {
  let num = 0n;
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(index);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');
  // Leading '1's in base58 encode leading zero bytes — restore them.
  let leadingZeros = 0;
  for (const char of input) {
    if (char === '1') leadingZeros++;
    else break;
  }
  return Buffer.concat([Buffer.alloc(leadingZeros, 0), bytes]);
}

/**
 * Verifies that `signatureBase58` is a real Ed25519 signature, produced
 * by the private key matching `walletAddressBase58`, over the exact
 * bytes of `message`. Returns false for any malformed input rather than
 * throwing — callers treat "not verified" uniformly whether the reason
 * is a bad signature or a malformed request.
 */
export function verifyWalletSignature(
  message: string,
  signatureBase58: string,
  walletAddressBase58: string
): boolean {
  try {
    const rawPublicKey = base58Decode(walletAddressBase58);
    if (rawPublicKey.length !== 32) return false;

    const signature = base58Decode(signatureBase58);
    if (signature.length !== 64) return false;

    const der = Buffer.concat([SPKI_ED25519_PREFIX, rawPublicKey]);
    const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });

    return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, signature);
  } catch {
    // Malformed base58, wrong-length key, or any other input problem —
    // never a valid signature, never throw into the caller.
    return false;
  }
}
