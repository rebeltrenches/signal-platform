/**
 * Tests both AlertRepository implementations. PrismaAlertRepository's
 * tests prove its LOGIC against a mock client — not that real Postgres
 * accepts these queries. No real database exists anywhere this project
 * has been built or tested.
 *
 * Run with: npx tsx apps/api/tests/alert-repository.test.ts
 */
import assert from 'node:assert';
import { MemoryAlertRepository } from '../src/alerts/MemoryAlertRepository.js';
import { PrismaAlertRepository, type AlertPrismaLikeClient } from '../src/alerts/PrismaAlertRepository.js';
import { AlertValidationError, AlertUnauthorizedError } from '../src/alerts/AlertRepository.js';
import { registerToken, __resetForTests as resetTokenStore } from '../src/tokens/tokenStore.js';

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

function createMockClient(): AlertPrismaLikeClient & { _wallets: any[]; _users: any[]; _tokens: any[]; _alerts: any[] } {
  const _wallets: any[] = [];
  const _users: any[] = [];
  const _tokens: any[] = [];
  const _alerts: any[] = [];
  let idCounter = 0;
  const nextId = () => `id_${++idCounter}`;

  return {
    _wallets, _users, _tokens, _alerts,
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
    token: {
      async findUnique({ where }: any) {
        const { chain, address } = where.chain_address;
        return _tokens.find((t) => t.chain === chain && t.address === address) ?? null;
      },
    },
    alert: {
      async findUnique({ where }: any) {
        const alert = _alerts.find((a) => a.id === where.id);
        if (!alert) return null;
        const user = _users.find((u) => u.id === alert.userId);
        const wallets = _wallets.filter((w) => w.userId === alert.userId);
        return { ...alert, user: user ? { ...user, wallets } : null };
      },
      async findMany({ where }: any) {
        return _alerts
          .filter((a) => a.userId === where.userId)
          .map((a) => ({ ...a, token: _tokens.find((t) => t.id === a.tokenId) }));
      },
      async create({ data }: any) {
        const row = { id: nextId(), userId: data.userId, tokenId: data.tokenId, kind: data.kind, thresholdJson: data.thresholdJson, active: true, createdAt: new Date() };
        _alerts.push(row);
        return row;
      },
      async delete({ where }: any) {
        const idx = _alerts.findIndex((a) => a.id === where.id);
        if (idx >= 0) _alerts.splice(idx, 1);
      },
    },
  };
}

async function run() {
  resetTokenStore();
  await registerToken({ chain: 'SOLANA', address: 'RealRegisteredMint111', name: 'Test', symbol: 'TST', decimals: 6, creatorWalletAddress: 'SomeCreator111' });

  // --- MemoryAlertRepository (uses the real, shared token store above) ---
  const memRepo = new MemoryAlertRepository();

  await test('[Memory] createAlert succeeds for a real, already-registered token', async () => {
    const alert = await memRepo.createAlert('WalletA111', {
      tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'price_move', threshold: { percent: 10 },
    });
    assert.strictEqual(alert.kind, 'price_move');
    assert.strictEqual(alert.active, true);
  });

  await test('[Memory] createAlert REJECTS an unregistered token — never invents a tokenId', async () => {
    await assert.rejects(
      () => memRepo.createAlert('WalletA111', { tokenChain: 'SOLANA', tokenAddress: 'NeverRegisteredMint999', kind: 'price_move', threshold: {} }),
      AlertValidationError
    );
  });

  await test('[Memory] createAlert rejects an invalid kind', async () => {
    await assert.rejects(
      () => memRepo.createAlert('WalletA111', { tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'not_a_real_kind' as any, threshold: {} }),
      AlertValidationError
    );
  });

  await test('[Memory] createAlert rejects a non-object threshold', async () => {
    await assert.rejects(
      () => memRepo.createAlert('WalletA111', { tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'price_move', threshold: 'not an object' as any }),
      AlertValidationError
    );
  });

  await test('[Memory] listAlerts returns only the requesting owner\'s alerts', async () => {
    await memRepo.createAlert('WalletB222', { tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'volume_move', threshold: { percent: 50 } });
    const aItems = await memRepo.listAlerts('WalletA111');
    const bItems = await memRepo.listAlerts('WalletB222');
    assert.ok(aItems.every((a) => a.ownerWalletAddress === 'WalletA111'));
    assert.ok(bItems.every((a) => a.ownerWalletAddress === 'WalletB222'));
  });

  await test('[Memory] removeAlert is a real no-op for a genuinely nonexistent alert', async () => {
    await memRepo.removeAlert('WalletC333', 'not-a-real-id');
  });

  await test('[Memory] removeAlert throws AlertUnauthorizedError for a different owner, and leaves it intact', async () => {
    const alert = await memRepo.createAlert('WalletOwner555', { tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'graduation', threshold: {} });
    await assert.rejects(() => memRepo.removeAlert('WalletAttacker666', alert.id), AlertUnauthorizedError);
    const stillThere = await memRepo.listAlerts('WalletOwner555');
    assert.ok(stillThere.some((a) => a.id === alert.id));
  });

  await test('[Memory] removeAlert actually removes it for its real owner', async () => {
    const alert = await memRepo.createAlert('WalletOwner777', { tokenChain: 'SOLANA', tokenAddress: 'RealRegisteredMint111', kind: 'liquidity_change', threshold: {} });
    await memRepo.removeAlert('WalletOwner777', alert.id);
    const remaining = await memRepo.listAlerts('WalletOwner777');
    assert.ok(!remaining.some((a) => a.id === alert.id));
  });

  // --- PrismaAlertRepository (own isolated mock, with its own registered token) ---
  const mockClient = createMockClient();
  mockClient._tokens.push({ id: 'tok_1', chain: 'SOLANA', address: 'MockRegisteredMint222' });
  const prismaRepo = new PrismaAlertRepository(mockClient);

  await test('[Prisma] createAlert succeeds for a real, already-registered token', async () => {
    const alert = await prismaRepo.createAlert('WalletP111', {
      tokenChain: 'SOLANA', tokenAddress: 'MockRegisteredMint222', kind: 'price_move', threshold: { percent: 5 },
    });
    assert.strictEqual(alert.tokenAddress, 'MockRegisteredMint222');
  });

  await test('[Prisma] createAlert REJECTS an unregistered token', async () => {
    await assert.rejects(
      () => prismaRepo.createAlert('WalletP111', { tokenChain: 'SOLANA', tokenAddress: 'NotRegistered999', kind: 'price_move', threshold: {} }),
      AlertValidationError
    );
  });

  await test('[Prisma] removeAlert throws for a different owner, succeeds for the real owner', async () => {
    const alert = await prismaRepo.createAlert('WalletP222', { tokenChain: 'SOLANA', tokenAddress: 'MockRegisteredMint222', kind: 'volume_move', threshold: {} });
    await assert.rejects(() => prismaRepo.removeAlert('WalletP333', alert.id), AlertUnauthorizedError);
    await prismaRepo.removeAlert('WalletP222', alert.id);
    const remaining = await prismaRepo.listAlerts('WalletP222');
    assert.ok(!remaining.some((a) => a.id === alert.id));
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
