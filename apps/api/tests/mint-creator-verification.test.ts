/**
 * Unit tests for tokens/verifyMintCreator.ts — the on-chain proof that a
 * wallet created a mint (audit item C2), against a fake JSON-RPC.
 *
 * Run with: npx tsx apps/api/tests/mint-creator-verification.test.ts
 */
import {
  verifySolanaMintCreator,
  isSolanaAddress,
  solanaRpcFromEnv,
  MintOwnershipError,
  MintVerificationUnavailableError,
  SPL_TOKEN_PROGRAM_ID,
  type SolanaRpcCall,
} from '../src/tokens/verifyMintCreator.js';
import { fakeSolanaRpc, randomSolanaAddress, type FakeMint } from './support/solanaTestKit.js';

let passed = 0;
function test(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok  - ${name}`);
    passed++;
  } else {
    console.log(`  FAIL - ${name}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  }
}

async function outcome(promise: Promise<void>): Promise<string> {
  try {
    await promise;
    return 'verified';
  } catch (err) {
    if (err instanceof MintOwnershipError) return 'ownership';
    if (err instanceof MintVerificationUnavailableError) return 'unavailable';
    return `other: ${(err as Error).message}`;
  }
}

function initTx(mint: string, authority: string, signers: string[], where: 'top' | 'inner' = 'top') {
  const ix = { program: 'spl-token', programId: SPL_TOKEN_PROGRAM_ID, parsed: { type: 'initializeMint', info: { mint, mintAuthority: authority } } };
  return {
    meta: { err: null, innerInstructions: where === 'inner' ? [{ index: 0, instructions: [ix] }] : [] },
    transaction: { message: { accountKeys: signers.map((pubkey) => ({ pubkey, signer: true })), instructions: where === 'top' ? [ix] : [] } },
  };
}

/** Wraps the standard fake, overriding signature history and transactions. */
function customRpc(mints: Map<string, FakeMint>, history: (before?: string) => unknown[], txs: Record<string, unknown>): SolanaRpcCall {
  const base = fakeSolanaRpc(mints);
  return async (method, params) => {
    if (method === 'getSignaturesForAddress') return history((params[1] as { before?: string }).before);
    if (method === 'getTransaction') return txs[params[0] as string] ?? null;
    return base(method, params);
  };
}

async function run() {
  const creator = randomSolanaAddress();
  const other = randomSolanaAddress();
  const mint = randomSolanaAddress();
  const mints = new Map<string, FakeMint>([[mint, { decimals: 6, initialAuthority: creator, creationSigners: [creator, mint] }]]);
  const rpc = fakeSolanaRpc(mints);

  test('the wallet that created and signed the mint is verified', (await outcome(verifySolanaMintCreator(rpc, mint, creator, 6))) === 'verified');
  test('a different wallet is refused', (await outcome(verifySolanaMintCreator(rpc, mint, other, 6))) === 'ownership');
  test('wrong decimals are refused', (await outcome(verifySolanaMintCreator(rpc, mint, creator, 9))) === 'ownership');

  // The real creator, but the mint can still mint more: not listable.
  const stillMintable = randomSolanaAddress();
  const stillMintableMints = new Map<string, FakeMint>([[stillMintable, { decimals: 6, initialAuthority: creator, creationSigners: [creator, stillMintable], currentMintAuthority: creator }]]);
  test('a mint whose authority is still active is refused, even for its creator', (await outcome(verifySolanaMintCreator(fakeSolanaRpc(stillMintableMints), stillMintable, creator, 6))) === 'ownership');
  test('a mint that does not exist is refused', (await outcome(verifySolanaMintCreator(rpc, randomSolanaAddress(), creator, 6))) === 'ownership');

  const notMint: SolanaRpcCall = async (method, params) =>
    method === 'getAccountInfo' ? { value: { owner: '11111111111111111111111111111111', data: ['', 'base64'] } } : rpc(method, params);
  test('an address that is not an SPL Token mint is refused', (await outcome(verifySolanaMintCreator(notMint, mint, creator, 6))) === 'ownership');

  // Named as mint authority by someone else's transaction: not "created".
  const namedOnly = randomSolanaAddress();
  const namedMints = new Map<string, FakeMint>([[namedOnly, { decimals: 6, initialAuthority: creator, creationSigners: [other, namedOnly] }]]);
  test('being set as authority without signing the creation is refused', (await outcome(verifySolanaMintCreator(fakeSolanaRpc(namedMints), namedOnly, creator, 6))) === 'ownership');

  // Signed the creation, but set someone else as authority.
  const gaveAway = randomSolanaAddress();
  const gaveAwayMints = new Map<string, FakeMint>([[gaveAway, { decimals: 6, initialAuthority: other, creationSigners: [creator, gaveAway] }]]);
  test('signing a creation that names another authority is refused', (await outcome(verifySolanaMintCreator(fakeSolanaRpc(gaveAwayMints), gaveAway, creator, 6))) === 'ownership');

  // initializeMint as an inner (CPI) instruction.
  const inner = customRpc(mints, () => [{ signature: 'c', err: null }], { c: initTx(mint, creator, [creator], 'inner') });
  test('a creation done through an inner instruction is found', (await outcome(verifySolanaMintCreator(inner, mint, creator, 6))) === 'verified');

  // Something touched the address before creation (e.g. a failed or unrelated tx).
  const junkFirst = customRpc(
    mints,
    () => [
      { signature: 'supply', err: null },
      { signature: 'create', err: null },
      { signature: 'failed', err: { InstructionError: [0, 'Custom'] } },
      { signature: 'lamports', err: null },
    ],
    { lamports: { meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [], instructions: [] } } }, create: initTx(mint, creator, [creator]) },
  );
  test('unrelated older transactions are skipped to find the creation', (await outcome(verifySolanaMintCreator(junkFirst, mint, creator, 6))) === 'verified');

  // Paging: 1000 newest, then the oldest 3 with the creation last.
  const fullPage = Array.from({ length: 1000 }, (_, i) => ({ signature: `new-${i}`, err: null }));
  const paged = customRpc(
    mints,
    (before) => (before ? [{ signature: 'x', err: null }, { signature: 'y', err: null }, { signature: 'create', err: null }] : fullPage),
    { create: initTx(mint, creator, [creator]) },
  );
  test('the creation is found on the oldest page of history', (await outcome(verifySolanaMintCreator(paged, mint, creator, 6))) === 'verified');

  const endless = customRpc(mints, () => fullPage, {});
  test('history too long to page through is "unavailable", not a pass', (await outcome(verifySolanaMintCreator(endless, mint, creator, 6))) === 'unavailable');

  const noCreation = customRpc(mints, () => [{ signature: 'x', err: null }], {});
  test('no creation transaction found is "unavailable", not a pass', (await outcome(verifySolanaMintCreator(noCreation, mint, creator, 6))) === 'unavailable');

  const down = fakeSolanaRpc(mints, { down: true });
  test('an RPC failure never verifies', (await outcome(verifySolanaMintCreator(down, mint, creator, 6))) !== 'verified');

  // --- isSolanaAddress ---
  test('a real-shaped address is accepted', isSolanaAddress(mint));
  test('"example" is not a Solana address', !isSolanaAddress('example'));
  test('a base58-invalid string is rejected', !isSolanaAddress('0OIl' + mint.slice(4)));
  test('a short base58 string is rejected', !isSolanaAddress('1111111111111111111111111111111'));

  // --- solanaRpcFromEnv ---
  const saved = process.env.SOLANA_RPC_URL;
  delete process.env.SOLANA_RPC_URL;
  test('no SOLANA_RPC_URL means no RPC (registration fails closed)', solanaRpcFromEnv() === null);
  process.env.SOLANA_RPC_URL = 'http://rpc.example.com';
  test('plain http to a remote host is refused', solanaRpcFromEnv() === null);
  process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
  test('plain http to this machine is allowed (local tests)', solanaRpcFromEnv() !== null);
  process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
  test('https is allowed', solanaRpcFromEnv() !== null);

  // Failures say why (status / RPC error / network code), never the URL,
  // which can carry an API key.
  const http = await import('node:http');
  const replies = [
    (res: any) => { res.writeHead(500); res.end('boom'); },
    (res: any) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too many requests' } })); },
  ];
  const fake = http.createServer((_req, res) => replies.shift()!(res));
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const secretUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}/?api-key=SECRET123`;
  process.env.SOLANA_RPC_URL = secretUrl;
  const envRpc = solanaRpcFromEnv()!;
  const failure = async () => { try { await envRpc('getAccountInfo', []); return ''; } catch (e) { return (e as Error).message; } };
  const httpError = await failure();
  const rpcError = await failure();
  fake.close();
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const closedPort = (closed.address() as { port: number }).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  process.env.SOLANA_RPC_URL = `http://127.0.0.1:${closedPort}/?api-key=SECRET123`; // nothing listens there now
  const refused = await (async () => { try { await solanaRpcFromEnv()!('getAccountInfo', []); return ''; } catch (e) { return (e as Error).message; } })();
  test('an HTTP error reports its status', httpError.includes('HTTP 500'), httpError);
  test('a JSON-RPC error reports its message', rpcError.includes('Too many requests'), rpcError);
  test('a network error reports its code', /ECONNREFUSED/.test(refused), refused);
  test('no failure message ever contains the URL or its key', ![httpError, rpcError, refused].some((m) => m.includes('SECRET123') || m.includes('127.0.0.1')));
  if (saved === undefined) delete process.env.SOLANA_RPC_URL;
  else process.env.SOLANA_RPC_URL = saved;

  console.log(`\n${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
