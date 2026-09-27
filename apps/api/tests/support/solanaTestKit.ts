/**
 * Test helpers for token registration (audit item C2): real Ed25519
 * test wallets that sign in through the real /api/v1/auth flow, random
 * valid Solana addresses, and a fake Solana JSON-RPC that answers the
 * three calls tokens/verifyMintCreator.ts makes, from a table of mints.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { SPL_TOKEN_PROGRAM_ID, type SolanaRpcCall } from '../../src/tokens/verifyMintCreator.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = BASE58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function randomSolanaAddress(): string {
  return base58Encode(crypto.randomBytes(32));
}

export interface TestWallet {
  address: string;
  privateKey: crypto.KeyObject;
}

export function makeWallet(): TestWallet {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: base58Encode(raw), privateKey };
}

/** Real sign-in: challenge, Ed25519 signature, session token. */
export async function signIn(base: string, wallet: TestWallet): Promise<string> {
  const challenge: any = await (await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}&chain=solana`)).json();
  const signature = base58Encode(crypto.sign(null, Buffer.from(challenge.message, 'utf8'), wallet.privateKey));
  const res = await fetch(`${base}/api/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chain: 'solana', nonce: challenge.nonce, timestamp: challenge.timestamp, signature }),
  });
  const body: any = await res.json();
  if (!body.sessionToken) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return body.sessionToken;
}

export interface FakeMint {
  decimals: number;
  /** Mint authority set by initializeMint in the creation transaction. */
  initialAuthority: string;
  /** Signers of the creation transaction (the creator pays and signs). */
  creationSigners: string[];
}

/** In-process fake of the Solana JSON-RPC calls the verifier makes.
 *  Each mint has a creation transaction and a later supply transaction
 *  (which doesn't initialize anything), newest first like the real RPC. */
export function fakeSolanaRpc(mints: Map<string, FakeMint>, options: { down?: boolean } = {}): SolanaRpcCall {
  return async (method, params) => {
    if (options.down) throw new Error('fake RPC is down');
    const [first] = params as [string];
    if (method === 'getAccountInfo') {
      const mint = mints.get(first);
      if (!mint) return { context: { slot: 1 }, value: null };
      return {
        context: { slot: 1 },
        value: {
          owner: SPL_TOKEN_PROGRAM_ID,
          data: { program: 'spl-token', parsed: { type: 'mint', info: { decimals: mint.decimals, isInitialized: true, mintAuthority: null, supply: '1' } } },
        },
      };
    }
    if (method === 'getSignaturesForAddress') {
      if (!mints.has(first)) return [];
      return [
        { signature: `supply-${first}`, err: null },
        { signature: `create-${first}`, err: null },
      ];
    }
    if (method === 'getTransaction') {
      const [kind, address] = first.split('-') as [string, string];
      const mint = mints.get(address);
      if (!mint) return null;
      if (kind === 'supply') {
        return { meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [], instructions: [] } } };
      }
      return {
        meta: { err: null, innerInstructions: [] },
        transaction: {
          message: {
            accountKeys: mint.creationSigners.map((pubkey) => ({ pubkey, signer: true })),
            instructions: [
              {
                program: 'spl-token',
                programId: SPL_TOKEN_PROGRAM_ID,
                parsed: { type: 'initializeMint2', info: { mint: address, decimals: mint.decimals, mintAuthority: mint.initialAuthority } },
              },
            ],
          },
        },
      };
    }
    throw new Error(`fake RPC: unexpected method ${method}`);
  };
}

/** The same fake served over HTTP JSON-RPC, for tests that run the real
 *  server with SOLANA_RPC_URL pointing at it. */
export async function startFakeSolanaRpcServer(mints: Map<string, FakeMint>): Promise<{ url: string; setDown(down: boolean): void; close(): void }> {
  const state = { down: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const request = JSON.parse(raw);
      try {
        const result = await fakeSolanaRpc(mints, state)(request.method, request.params);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      } catch (err) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: (err as Error).message } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, setDown: (down) => { state.down = down; }, close: () => server.close() };
}
