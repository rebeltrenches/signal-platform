import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../src/server.js';
import { __setProfileRepositoryForTests } from '../src/profiles/profileStore.js';
import { MemoryProfileRepository } from '../src/profiles/MemoryProfileRepository.js';
import { __resetForTests as resetTokens, registerToken } from '../src/tokens/tokenStore.js';
import { issueSessionToken } from '../src/auth/AuthSession.js';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer) {
  let n = BigInt('0x' + bytes.toString('hex')); let text = '';
  while (n > 0n) { text = alphabet[Number(n % 58n)] + text; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = '1' + text; }
  return text;
}
function wallet() { const pair = crypto.generateKeyPairSync('ed25519'); return { ...pair, address: base58(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)) }; }
let checks = 0;
function check(value: unknown, expected: unknown, message: string) { assert.deepEqual(value, expected, message); checks++; console.log(`  ok - ${message}`); }
async function run() {
process.env.AUTH_SECRET = 'profiles-test-only-secret';
resetTokens(); __setProfileRepositoryForTests(new MemoryProfileRepository());
const server = createServer(); await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function signIn(owner: ReturnType<typeof wallet>) {
  const challenge: any = await (await fetch(`${base}/api/v1/auth/challenge?address=${owner.address}&chain=solana`)).json();
  const response = await fetch(`${base}/api/v1/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...challenge, message: undefined, address: owner.address, chain: 'solana', signature: base58(crypto.sign(null, Buffer.from(challenge.message), owner.privateKey)) }) });
  return (await response.json() as any).sessionToken as string;
}
async function call(path: string, token = '', method = 'GET', data?: unknown) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, body: await response.json() as any, headers: response.headers };
}
const input = { username: 'richard_test', displayName: 'Richard', bio: 'Building Signal', avatar: '', banner: '', accent: '#8b5cf6', theme: 'aurora', roles: ['creator','researcher'], website: 'https://example.com', twitter: 'https://x.com/example', telegram: '', isPublic: false, showWallet: false, showProjects: false, featuredTokenAddress: '' };
try {
  const a = wallet(), b = wallet(), tokenA = await signIn(a), tokenB = await signIn(b);
  check((await call('/api/v1/profiles/me')).status, 401, 'owner route requires signed session');
  check((await call('/api/v1/profiles/me', tokenA + 'tampered')).status, 401, 'tampered sessions rejected');
  check((await call('/api/v1/profiles/me', issueSessionToken(a.address, 'base'))).status, 401, 'another chain session cannot claim a Solana profile');
  check((await call('/api/v1/profiles/me', tokenA)).body.profile, null, 'new user has no fabricated profile');
  check((await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, ownerWalletAddress: b.address })).status, 400, 'cannot supply another profile owner');
  const create = await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, username: 'Richard_Test' });
  check(create.status, 200, 'signed wallet creates its profile');
  check(create.body.profile.username, 'richard_test', 'usernames canonicalized to lowercase');
  check(create.body.profile.ownerWalletAddress, a.address, 'owner derives from signed session');
  check((await call('/api/v1/profiles/richard_test')).status, 404, 'private profile cannot be fetched publicly');
  check((await call('/api/v1/profiles/me', tokenB)).body.profile, null, 'another user cannot read private profile');
  check((await call('/api/v1/profiles/me', tokenB, 'PUT', input)).status, 409, 'case-insensitive username cannot be claimed twice');
  check((await call('/api/v1/profiles/me', tokenB, 'DELETE')).status, 200, 'deleting own absent profile is harmless');
  check((await call('/api/v1/profiles/me', tokenA)).body.profile.displayName, 'Richard', 'cross-wallet delete cannot touch real owner');
  const mint = 'ProfileProjectMint111111111111111111111';
  await registerToken({ chain: 'SOLANA', address: mint, name: 'Project', symbol: 'TEST', decimals: 6, creatorWalletAddress: a.address });
  check((await call('/api/v1/profiles/me', tokenB, 'PUT', { ...input, username: 'other_user', featuredTokenAddress: mint })).status, 400, 'cannot feature another wallet project');
  check((await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, isPublic: true, featuredTokenAddress: mint })).status, 200, 'owner can feature registered project');
  const pub = await call('/api/v1/profiles/RICHARD_TEST');
  check(pub.status, 200, 'public profile available through canonical username');
  check(pub.body.profile.walletAddress, undefined, 'wallet hidden by default');
  check(pub.body.profile.ownerWalletAddress, undefined, 'private owner field never leaks');
  check(pub.body.profile.showWallet, undefined, 'private preferences never leak');
  check(pub.body.projects, [], 'projects hidden independently');
  check(pub.body.profile.walletOwnershipVerified, true, 'wallet proof comes from authenticated profile creation');
  check(pub.headers.get('cache-control'), 'no-store', 'public response cannot serve cached data after privacy change');
  await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, isPublic: true, showWallet: true, showProjects: true, featuredTokenAddress: mint });
  const visible = await call('/api/v1/profiles/richard_test');
  check(visible.body.profile.walletAddress, a.address, 'wallet shown only after explicit opt-in');
  check(visible.body.projects.length, 1, 'registered projects shown after opt-in');
  check(visible.body.projects[0].featured, true, 'featured project identified');
  check(visible.body.projects[0].creatorWalletAddress, undefined, 'project serialization excludes raw private owner record');
  for (const invalid of [{ username: 'admin' }, { username: 'a/b' }, { website: 'javascript:alert(1)' }, { website: 'https://127.0.0.1' }, { twitter: 'https://evil.example/x.com' }, { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }, { avatar: 'data:image/png;base64,PHN2Zz4=' }, { accent: 'red;display:none' }, { roles: ['admin'] }, { isPublic: 'true' }, { bio: 'x'.repeat(281) }, { walletOwnershipVerified: true }]) {
    check((await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, ...invalid })).status, 400, `reject invalid profile: ${Object.keys(invalid)[0]}`);
  }
  await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, username: 'renamed_user', isPublic: true });
  check((await call('/api/v1/profiles/richard_test')).status, 404, 'old username stops serving renamed profile');
  await call('/api/v1/profiles/me', tokenA, 'PUT', { ...input, username: 'renamed_user' });
  check((await call('/api/v1/profiles/renamed_user')).status, 404, 'unpublishing takes effect immediately');
  await call('/api/v1/profiles/me', tokenA, 'DELETE');
  check((await call('/api/v1/profiles/me', tokenA)).body.profile, null, 'delete removes profile');
  check((await call('/api/v1/profiles/me', tokenB, 'PUT', { ...input, username: 'renamed_user' })).status, 200, 'deleted username released');
  __setProfileRepositoryForTests(null);
  check((await call('/api/v1/profiles/me', tokenA, 'PUT', input)).status, 503, 'missing durable storage never fakes save success');
  console.log(`${checks} profile route checks passed.`);
} finally { server.close(); __setProfileRepositoryForTests(null); delete process.env.AUTH_SECRET; }

}
run().catch((error) => { console.error(error); process.exitCode = 1; });
