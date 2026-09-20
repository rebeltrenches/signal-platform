/**
 * Tests both WatchlistRepository implementations. PrismaWatchlistRepository's
 * tests prove its LOGIC against a mock client — not that real Postgres
 * accepts these queries. No real database exists anywhere this project
 * has been built or tested.
 *
 * Run with: npx tsx apps/api/tests/watchlist-repository.test.ts
 */
import assert from 'node:assert';
import { MemoryWatchlistRepository } from '../src/watchlist/MemoryWatchlistRepository.js';
import { PrismaWatchlistRepository, type WatchlistPrismaLikeClient } from '../src/watchlist/PrismaWatchlistRepository.js';
import { WatchlistValidationError, WatchlistUnauthorizedError } from '../src/watchlist/WatchlistRepository.js';
import type { WatchlistRepository } from '../src/watchlist/WatchlistRepository.js';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
}

function createMockClient(): WatchlistPrismaLikeClient & { _wallets: any[]; _users: any[]; _items: any[] } {
  const _wallets: any[] = [];
  const _users: any[] = [];
  const _items: any[] = [];
  let idCounter = 0;
  const nextId = () => `id_${++idCounter}`;

  return {
    _wallets, _users, _items,
    wallet: {
      async findUnique({ where }: any) {
        const { address, chain } = where.address_chain;
        return _wallets.find((w) => w.address === address && w.chain === chain) ?? null;
      },
      async create({ data }: any) {
        const row = { id: nextId(), address: data.address, chain: data.chain, userId: null };
        _wallets.push(row);
        return row;
      },
      async update({ where, data }: any) {
        const w = _wallets.find((x) => x.id === where.id)!;
        Object.assign(w, data);
        return w;
      },
    },
    user: {
      async create() {
        const row = { id: nextId() };
        _users.push(row);
        return row;
      },
    },
    watchlist: {
      async findFirst({ where }: any) {
        return _items.find((i) => i.userId === where.userId && i.walletAddress === where.walletAddress) ?? null;
      },
      async findUnique({ where }: any) {
        const item = _items.find((i) => i.id === where.id);
        if (!item) return null;
        const user = _users.find((u) => u.id === item.userId);
        const wallets = _wallets.filter((w) => w.userId === item.userId);
        return { ...item, user: user ? { ...user, wallets } : null };
      },
      async findMany({ where }: any) {
        return _items.filter((i) => i.userId === where.userId);
      },
      async create({ data }: any) {
        const row = { id: nextId(), userId: data.userId, walletAddress: data.walletAddress, createdAt: new Date() };
        _items.push(row);
        return row;
      },
      async delete({ where }: any) {
        const idx = _items.findIndex((i) => i.id === where.id);
        if (idx >= 0) _items.splice(idx, 1);
      },
    },
  };
}

async function runAgainst(repoName: string, repo: WatchlistRepository) {
  await test(`[${repoName}] addItem is idempotent — adding the same value twice returns the same record`, async () => {
    const a = await repo.addItem('WalletA111', 'SomeTokenAddress111');
    const b = await repo.addItem('WalletA111', 'SomeTokenAddress111');
    assert.strictEqual(a.id, b.id);
  });

  await test(`[${repoName}] listItems returns only the requesting owner's items`, async () => {
    await repo.addItem('WalletB222', 'TokenX');
    await repo.addItem('WalletC333', 'TokenY');
    const bItems = await repo.listItems('WalletB222');
    assert.ok(bItems.some((i) => i.value === 'TokenX'));
    assert.ok(!bItems.some((i) => i.value === 'TokenY'));
  });

  await test(`[${repoName}] removeItem is a real no-op (not an error) for a genuinely nonexistent item`, async () => {
    await repo.removeItem('WalletD444', 'not-a-real-id-at-all');
  });

  await test(`[${repoName}] removeItem throws WatchlistUnauthorizedError for an item belonging to a DIFFERENT owner`, async () => {
    const item = await repo.addItem('WalletOwner555', 'TokenZ');
    await assert.rejects(() => repo.removeItem('WalletAttacker666', item.id), WatchlistUnauthorizedError);
    // And confirm it's genuinely still there afterward — the rejected
    // attempt must not have removed it anyway.
    const stillThere = await repo.listItems('WalletOwner555');
    assert.ok(stillThere.some((i) => i.id === item.id));
  });

  await test(`[${repoName}] removeItem actually removes the item for its real owner`, async () => {
    const item = await repo.addItem('WalletOwner777', 'TokenToRemove');
    await repo.removeItem('WalletOwner777', item.id);
    const remaining = await repo.listItems('WalletOwner777');
    assert.ok(!remaining.some((i) => i.id === item.id));
  });

  await test(`[${repoName}] addItem rejects an empty value`, async () => {
    await assert.rejects(() => repo.addItem('WalletE888', '   '), WatchlistValidationError);
  });
}

async function run() {
  await runAgainst('Memory', new MemoryWatchlistRepository());
  await runAgainst('Prisma (mock)', new PrismaWatchlistRepository(createMockClient()));

  await test('PrismaWatchlistRepository creates a real linked User for a wallet with none, reusing it on the next call', async () => {
    const client = createMockClient();
    const repo = new PrismaWatchlistRepository(client);
    await repo.addItem('WalletF999', 'Token1');
    await repo.addItem('WalletF999', 'Token2');
    assert.strictEqual(client._users.length, 1, 'the same wallet must resolve to the same User both times');
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
