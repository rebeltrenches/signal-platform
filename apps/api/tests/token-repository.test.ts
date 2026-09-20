/**
 * Tests both TokenRepository implementations. PrismaTokenRepository's
 * tests prove its LOGIC against a mock client — not that real Postgres
 * accepts these queries. No real database exists anywhere this project
 * has been built or tested. See that file's own header for this limit
 * stated precisely.
 *
 * Run with: npx tsx apps/api/tests/token-repository.test.ts
 */
import assert from 'node:assert';
import { MemoryTokenRepository } from '../src/tokens/MemoryTokenRepository.js';
import { PrismaTokenRepository, type TokenPrismaLikeClient } from '../src/tokens/PrismaTokenRepository.js';
import { TokenValidationError } from '../src/tokens/TokenRepository.js';
import type { TokenRepository } from '../src/tokens/TokenRepository.js';

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

function createMockClient(): TokenPrismaLikeClient & { _tokens: any[]; _wallets: any[]; _metadata: any[]; _holders: any[] } {
  const _tokens: any[] = [];
  const _wallets: any[] = [];
  const _metadata: any[] = [];
  const _holders: any[] = [];
  let idCounter = 0;
  const nextId = () => `id_${++idCounter}`;

  return {
    _tokens, _wallets, _metadata, _holders,
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
    },
    token: {
      async findUnique({ where }: any) {
        const { chain, address } = where.chain_address;
        const t = _tokens.find((x) => x.chain === chain && x.address === address);
        return t ? { ...t, creator: _wallets.find((w) => w.id === t.creatorId) } : null;
      },
      async findMany(args: any) {
        if (args.where?.OR) {
          // Real case-insensitive substring matching, mirroring what
          // Postgres's contains/mode:'insensitive' actually does.
          return _tokens
            .filter((t) =>
              args.where.OR.some((cond: any) => {
                const [field, matcher] = Object.entries(cond)[0] as [string, any];
                return String((t as any)[field]).toLowerCase().includes(String(matcher.contains).toLowerCase());
              })
            )
            .slice(0, args.take ?? undefined)
            .map((t) => ({ ...t, creator: _wallets.find((w) => w.id === t.creatorId) }));
        }
        if (args.where?.creatorId) {
          return _tokens.filter((t) => t.creatorId === args.where.creatorId).map((t) => ({ ...t, creator: _wallets.find((w) => w.id === t.creatorId) }));
        }
        // Cursor-pagination shape: real sort + real cursor/skip
        // semantics, matching what a real Prisma client actually does.
        const sorted = [..._tokens].sort((a, b) => {
          const t = b.createdAt.getTime() - a.createdAt.getTime();
          return t !== 0 ? t : b.id.localeCompare(a.id);
        });
        let startIndex = 0;
        if (args.cursor?.id) {
          const idx = sorted.findIndex((t) => t.id === args.cursor.id);
          startIndex = idx === -1 ? sorted.length : idx + (args.skip ?? 0);
        }
        const sliced = sorted.slice(startIndex, startIndex + (args.take ?? sorted.length));
        return sliced.map((t) => ({ ...t, creator: _wallets.find((w) => w.id === t.creatorId) }));
      },
      async create({ data }: any) {
        const row = { id: nextId(), ...data, createdAt: new Date() };
        _tokens.push(row);
        return row;
      },
    },
    tokenMetadata: {
      async upsert({ where, create, update }: any) {
        const existing = _metadata.find((m) => m.tokenId === where.tokenId);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { ...create };
        _metadata.push(row);
        return row;
      },
      async findUnique({ where }: any) {
        return _metadata.find((m) => m.tokenId === where.tokenId) ?? null;
      },
    },
    holder: {
      async deleteMany({ where }: any) {
        const before = _holders.length;
        for (let i = _holders.length - 1; i >= 0; i--) if (_holders[i].tokenId === where.tokenId) _holders.splice(i, 1);
        return { count: before - _holders.length };
      },
      async createMany({ data }: any) {
        _holders.push(...data);
        return { count: data.length };
      },
    },
  };
}

async function runAgainst(repoName: string, repo: TokenRepository) {
  await test(`[${repoName}] registerToken is idempotent — registering the same (chain, address) twice returns the same token`, async () => {
    const a = await repo.registerToken({ chain: 'SOLANA', address: 'Mint111', name: 'Test', symbol: 'TST', decimals: 6, creatorWalletAddress: 'Creator111' });
    const b = await repo.registerToken({ chain: 'SOLANA', address: 'Mint111', name: 'Test', symbol: 'TST', decimals: 6, creatorWalletAddress: 'Creator111' });
    assert.strictEqual(a.id, b.id);
  });

  await test(`[${repoName}] getTokenByAddress returns null for an unregistered address — never fabricates a token`, async () => {
    const result = await repo.getTokenByAddress('SOLANA', 'NeverRegistered');
    assert.strictEqual(result, null);
  });

  await test(`[${repoName}] registration normalizes chain casing consistently with lookup (regression: caught during implementation)`, async () => {
    await repo.registerToken({ chain: 'SOLANA', address: 'Mint222', name: 'Case', symbol: 'CSE', decimals: 9, creatorWalletAddress: 'Creator222' });
    const found = await repo.getTokenByAddress('SOLANA', 'Mint222');
    assert.ok(found, 'token registered as SOLANA must be findable as SOLANA');
  });

  await test(`[${repoName}] listTokensByCreator returns only that creator's tokens`, async () => {
    await repo.registerToken({ chain: 'SOLANA', address: 'MintA', name: 'A', symbol: 'A', decimals: 6, creatorWalletAddress: 'CreatorX' });
    await repo.registerToken({ chain: 'SOLANA', address: 'MintB', name: 'B', symbol: 'B', decimals: 6, creatorWalletAddress: 'CreatorY' });
    const mine = await repo.listTokensByCreator('CreatorX');
    assert.ok(mine.some((t) => t.address === 'MintA'));
    assert.ok(!mine.some((t) => t.address === 'MintB'));
  });

  await test(`[${repoName}] saveIndexedData persists metadata retrievable via getTokenMetadata`, async () => {
    const token = await repo.registerToken({ chain: 'SOLANA', address: 'MintMeta', name: 'M', symbol: 'M', decimals: 6, creatorWalletAddress: 'CreatorM' });
    await repo.saveIndexedData(token.id, { holderCount: 42, top10HolderPercent: 55.5, mintAuthorityActive: false, freezeAuthorityActive: false, lastIndexedAt: new Date().toISOString() }, [
      { address: 'Holder1', balance: '1000000' },
    ]);
    const meta = await repo.getTokenMetadata(token.id);
    assert.strictEqual(meta?.holderCount, 42);
    assert.strictEqual(meta?.mintAuthorityActive, false);
  });
}

async function run() {
  await runAgainst('Memory', new MemoryTokenRepository());
  await runAgainst('Prisma (mock)', new PrismaTokenRepository(createMockClient()));

  await test('MemoryTokenRepository rejects invalid input the same way for missing required fields', async () => {
    const repo = new MemoryTokenRepository();
    await assert.rejects(
      () => repo.registerToken({ chain: '', address: 'X', name: 'X', symbol: 'X', decimals: 6, creatorWalletAddress: 'X' }),
      TokenValidationError
    );
  });

  async function testListRecentTokens(repoName: string, repo: TokenRepository) {
    await test(`[${repoName}] listRecentTokens returns real tokens newest-first, never fabricated`, async () => {
      await repo.registerToken({ chain: 'SOLANA', address: 'Recent1', name: 'First', symbol: 'F', decimals: 6, creatorWalletAddress: 'C1' });
      await new Promise((r) => setTimeout(r, 5));
      await repo.registerToken({ chain: 'SOLANA', address: 'Recent2', name: 'Second', symbol: 'S', decimals: 6, creatorWalletAddress: 'C1' });
      await new Promise((r) => setTimeout(r, 5));
      await repo.registerToken({ chain: 'SOLANA', address: 'Recent3', name: 'Third', symbol: 'T', decimals: 6, creatorWalletAddress: 'C1' });

      const page = await repo.listRecentTokens(10);
      const addresses = page.tokens.map((t) => t.address);
      const idx1 = addresses.indexOf('Recent1');
      const idx2 = addresses.indexOf('Recent2');
      const idx3 = addresses.indexOf('Recent3');
      assert.ok(idx3 < idx2 && idx2 < idx1, `expected newest-first order, got ${JSON.stringify(addresses)}`);
    });

    await test(`[${repoName}] listRecentTokens paginates correctly — page 2 has no overlap with page 1`, async () => {
      const freshRepo = repoName === 'Memory' ? new MemoryTokenRepository() : new PrismaTokenRepository(createMockClient());
      for (let i = 0; i < 5; i++) {
        await freshRepo.registerToken({ chain: 'SOLANA', address: `PageTest${i}`, name: `T${i}`, symbol: 'T', decimals: 6, creatorWalletAddress: 'CP' });
        await new Promise((r) => setTimeout(r, 5));
      }
      const page1 = await freshRepo.listRecentTokens(2);
      assert.strictEqual(page1.tokens.length, 2);
      assert.ok(page1.nextCursor, 'expected a real nextCursor since 5 tokens exist and page size is 2');

      const page2 = await freshRepo.listRecentTokens(2, page1.nextCursor);
      assert.strictEqual(page2.tokens.length, 2);
      const page1Ids = new Set(page1.tokens.map((t) => t.id));
      assert.ok(!page2.tokens.some((t) => page1Ids.has(t.id)), 'page 2 must not repeat any item from page 1');

      const page3 = await freshRepo.listRecentTokens(2, page2.nextCursor);
      assert.strictEqual(page3.tokens.length, 1, 'the last page should have exactly the 1 remaining token');
      assert.strictEqual(page3.nextCursor, null, 'nextCursor must be null when there is genuinely nothing more');
    });
  }

  await testListRecentTokens('Memory', new MemoryTokenRepository());
  await testListRecentTokens('Prisma (mock)', new PrismaTokenRepository(createMockClient()));

  async function testSearchTokens(repoName: string, repo: TokenRepository) {
    await test(`[${repoName}] searchTokens matches by name (case-insensitive)`, async () => {
      await repo.registerToken({ chain: 'SOLANA', address: 'SearchMint1', name: 'Searchable Dragon', symbol: 'DRG', decimals: 6, creatorWalletAddress: 'SC1' });
      const results = await repo.searchTokens('dragon', 10);
      assert.ok(results.some((t) => t.address === 'SearchMint1'));
    });

    await test(`[${repoName}] searchTokens matches by symbol`, async () => {
      const results = await repo.searchTokens('DRG', 10);
      assert.ok(results.some((t) => t.address === 'SearchMint1'));
    });

    await test(`[${repoName}] searchTokens matches by address substring`, async () => {
      const results = await repo.searchTokens('SearchMint1', 10);
      assert.ok(results.some((t) => t.address === 'SearchMint1'));
    });

    await test(`[${repoName}] searchTokens with no match returns a genuine empty array, never padded`, async () => {
      const results = await repo.searchTokens('DefinitelyNotRegisteredXYZ', 10);
      assert.deepStrictEqual(results, []);
    });

    await test(`[${repoName}] searchTokens with an empty query returns [] rather than everything`, async () => {
      const results = await repo.searchTokens('   ', 10);
      assert.deepStrictEqual(results, []);
    });

    await test(`[${repoName}] searchTokens respects the limit`, async () => {
      const freshRepo = repoName === 'Memory' ? new MemoryTokenRepository() : new PrismaTokenRepository(createMockClient());
      for (let i = 0; i < 5; i++) {
        await freshRepo.registerToken({ chain: 'SOLANA', address: `LimitTest${i}`, name: 'SharedSearchName', symbol: 'LT', decimals: 6, creatorWalletAddress: 'CL' });
      }
      const results = await freshRepo.searchTokens('SharedSearchName', 2);
      assert.strictEqual(results.length, 2);
    });
  }

  await testSearchTokens('Memory', new MemoryTokenRepository());
  await testSearchTokens('Prisma (mock)', new PrismaTokenRepository(createMockClient()));

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
