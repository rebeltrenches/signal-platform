// Only run against the isolated CI/test database, never production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getSharedPrismaClient } from '../src/db/prismaClient.js';
import { PrismaProfileRepository } from '../src/profiles/PrismaProfileRepository.js';
import { ProfileConflictError } from '../src/profiles/ProfileRepository.js';
async function run() {
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Profile DB verification requires a local isolated *_test database.');
const db = await getSharedPrismaClient();
const repository = new PrismaProfileRepository(db);
const suffix = crypto.randomBytes(8).toString('hex');
const owners = ['a','b'].map((v) => `profile_test_${v}_${suffix}`);
const input = { username: `profile_${suffix}`, displayName: 'Test', bio: '', avatar: '', banner: '', accent: '#8b5cf6', theme: 'aurora', roles: ['creator'], website: '', twitter: '', telegram: '', isPublic: false, showWallet: false, showProjects: false, featuredTokenAddress: '' };
try {
  const results = await Promise.allSettled(owners.map((owner) => repository.save(owner, input)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one concurrent claimant wins');
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ProfileConflictError, 'database username constraint mapped to conflict');
  const winner = await repository.getByUsername(input.username);
  assert.ok(winner); assert.equal(winner.isPublic, false);
  const updated = await repository.save(winner.ownerWalletAddress, { ...input, username: `renamed_${suffix}`, displayName: 'Updated', isPublic: true });
  assert.equal(updated.createdAt, winner.createdAt); assert.equal(updated.displayName, 'Updated');
  assert.equal(await repository.getByUsername(input.username), null);
  assert.equal((await repository.getByWallet(winner.ownerWalletAddress))?.isPublic, true);
  assert.equal(await db.userProfile.count({ where: { ownerAddress: winner.ownerWalletAddress } }), 1);
  await repository.remove(winner.ownerWalletAddress);
  assert.equal(await repository.getByUsername(updated.username), null);
  console.log('Profile PostgreSQL persistence, unique username races, updates and deletion passed.');
} finally {
  await db.userProfile.deleteMany({ where: { ownerAddress: { in: owners } } });
  await db.wallet.deleteMany({ where: { address: { in: owners }, chain: 'SOLANA' } });
  await db.$disconnect();
}

}
run().catch((error) => { console.error(error); process.exitCode = 1; });
