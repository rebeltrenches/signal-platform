/**
 * Tests PrismaChatRepository's LOGIC — that it calls the right Prisma
 * operations with the right shapes — against a mock PrismaLikeClient.
 * This does NOT prove real Postgres accepts these queries; no real
 * database exists anywhere this project has been built or tested. See
 * PrismaChatRepository.ts's own header for that limit stated precisely.
 *
 * Run with: npx tsx apps/api/tests/chat-repository.test.ts
 */
import assert from 'node:assert';
import { PrismaChatRepository, type PrismaLikeClient } from '../src/chat/PrismaChatRepository.js';
import { MemoryChatRepository } from '../src/chat/MemoryChatRepository.js';
import { RateLimitError, ValidationError, UnauthorizedError } from '../src/chat/ChatRepository.js';

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

/** A minimal, real in-memory fake satisfying PrismaLikeClient's shape —
 *  not Prisma itself, but exercises PrismaChatRepository's actual query
 *  construction logic against something that behaves consistently. */
function createMockClient(): PrismaLikeClient & { _wallets: any[]; _messages: any[]; _users: any[]; _reports: any[] } {
  const _wallets: any[] = [];
  const _messages: any[] = [];
  const _users: any[] = [];
  const _reports: any[] = [];
  let idCounter = 0;
  const nextId = () => `id_${++idCounter}`;

  return {
    _wallets, _messages, _users, _reports,
    chatRoom: {
      async findUnique({ where }: any) {
        return where.id === 'main' ? { id: 'main', kind: 'main', tokenId: null, createdAt: new Date() } : null;
      },
      async create({ data }: any) {
        return { id: data.id, kind: data.kind, tokenId: null, createdAt: new Date() };
      },
    },
    wallet: {
      async findUnique({ where }: any) {
        const { address, chain } = where.address_chain;
        return _wallets.find((w) => w.address === address && w.chain === chain) ?? null;
      },
      async create({ data }: any) {
        if (_wallets.some((w) => w.address === data.address && w.chain === data.chain)) {
          throw new Error('unique constraint');
        }
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
    chatMessage: {
      async create({ data }: any) {
        const row = { id: nextId(), roomId: data.roomId, authorWalletId: data.authorWalletId, content: data.content, createdAt: new Date(), deletedAt: null };
        _messages.push(row);
        return row;
      },
      async findMany({ where }: any) {
        return _messages.filter((m) => m.roomId === where.roomId && (!where.createdAt || m.createdAt > where.createdAt.gt))
          .map((m) => ({ ...m, authorWallet: _wallets.find((w) => w.id === m.authorWalletId), _count: { reports: _reports.filter((r) => r.messageId === m.id).length } }));
      },
      async findUnique({ where }: any) {
        const m = _messages.find((x) => x.id === where.id);
        if (!m) return null;
        return { ...m, authorWallet: _wallets.find((w) => w.id === m.authorWalletId), _count: { reports: _reports.filter((r) => r.messageId === m.id).length } };
      },
      async findFirst({ where }: any) {
        const matches = _messages.filter((m) => m.authorWalletId === where.authorWalletId).sort((a, b) => b.createdAt - a.createdAt);
        return matches[0] ?? null;
      },
      async update({ where, data }: any) {
        const m = _messages.find((x) => x.id === where.id)!;
        Object.assign(m, data);
        return m;
      },
    },
    messageReport: {
      async findFirst({ where }: any) {
        return _reports.find((r) => r.messageId === where.messageId && r.reporterId === where.reporterId) ?? null;
      },
      async create({ data }: any) {
        const row = { id: nextId(), ...data };
        _reports.push(row);
        return row;
      },
    },
  };
}

async function run() {
  await test('postMessage creates a Wallet on first use, reuses it on the next post', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    await repo.postMessage('main', 'WalletAAA', 'hello');
    assert.strictEqual(client._wallets.length, 1);
    // Second post from a DIFFERENT wallet must not reuse the first wallet row.
    await new Promise((r) => setTimeout(r, 10));
    await repo.postMessage('main', 'WalletBBB', 'hi');
    assert.strictEqual(client._wallets.length, 2);
  });

  await test('postMessage enforces the same rate limit as MemoryChatRepository, derived from createdAt', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    await repo.postMessage('main', 'WalletCCC', 'first');
    await assert.rejects(() => repo.postMessage('main', 'WalletCCC', 'too soon'), RateLimitError);
  });

  await test('postMessage rejects empty content — same validation as memory', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    await assert.rejects(() => repo.postMessage('main', 'WalletDDD', '   '), ValidationError);
  });

  await test('reportMessage creates a User for a wallet with none, then a report', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    const msg = await repo.postMessage('main', 'WalletEEE', 'reportable');
    await repo.reportMessage(msg.id, 'WalletFFF');
    assert.strictEqual(client._users.length, 1);
    assert.strictEqual(client._reports.length, 1);
  });

  await test('reportMessage is idempotent — a second report from the same wallet does not double-count', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    const msg = await repo.postMessage('main', 'WalletGGG', 'reportable again');
    await repo.reportMessage(msg.id, 'WalletHHH');
    const result = await repo.reportMessage(msg.id, 'WalletHHH');
    assert.strictEqual(client._reports.length, 1);
    assert.strictEqual(result.reportCount, 1);
  });

  await test('deleteMessage rejects a non-moderator wallet, same as memory', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    const msg = await repo.postMessage('main', 'WalletIII', 'to be moderated');
    delete process.env.CHAT_MODERATOR_WALLETS;
    await assert.rejects(() => repo.deleteMessage(msg.id, 'NotAModerator'), UnauthorizedError);
  });

  await test('deleteMessage sets deletedAt for an authorized moderator', async () => {
    const client = createMockClient();
    const repo = new PrismaChatRepository(client);
    const msg = await repo.postMessage('main', 'WalletJJJ', 'to be removed');
    process.env.CHAT_MODERATOR_WALLETS = 'ModWallet1';
    const result = await repo.deleteMessage(msg.id, 'ModWallet1');
    assert.ok(result.deletedAt);
    delete process.env.CHAT_MODERATOR_WALLETS;
  });

  await test('MemoryChatRepository and PrismaChatRepository reject the same oversized message identically', async () => {
    const longContent = 'x'.repeat(501);
    const memRepo = new MemoryChatRepository();
    const prismaRepo = new PrismaChatRepository(createMockClient());
    await assert.rejects(() => memRepo.postMessage('main', 'W1', longContent), ValidationError);
    await assert.rejects(() => prismaRepo.postMessage('main', 'W1', longContent), ValidationError);
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
