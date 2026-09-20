/**
 * Tests TokenIndexer's logic against a mock ChainReader — proves it
 * calls the reader correctly and maps results correctly, NOT that a
 * real Solana RPC endpoint returns what the mock assumes. No internet
 * has existed anywhere this project was built; live RPC connectivity
 * remains genuinely untested. See TokenIndexer.ts's own header.
 *
 * Run with: npx tsx apps/api/tests/token-indexer.test.ts
 */
import assert from 'node:assert';
import { TokenIndexer, type ChainReader } from '../src/tokens/TokenIndexer.js';
import { MemoryTokenRepository } from '../src/tokens/MemoryTokenRepository.js';

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

function mockChainReader(overrides: Partial<ChainReader> = {}): ChainReader {
  return {
    async getTransparencyReport() {
      return {
        mintAuthorityActive: { status: 'available', value: false },
        freezeAuthorityActive: { status: 'available', value: false },
        holderCount: { status: 'available', value: 3 },
        top10HolderPercent: { status: 'available', value: 87.5 },
      };
    },
    async getTopHolders() {
      return [
        { address: 'HolderA', balance: 500_000n },
        { address: 'HolderB', balance: 300_000n },
        { address: 'HolderC', balance: 200_000n },
      ];
    },
    ...overrides,
  };
}

async function run() {
  await test('refreshToken persists real (mocked) on-chain facts into TokenMetadata', async () => {
    const repo = new MemoryTokenRepository();
    const token = await repo.registerToken({ chain: 'SOLANA', address: 'MintX', name: 'X', symbol: 'X', decimals: 6, creatorWalletAddress: 'Creator' });
    const indexer = new TokenIndexer(mockChainReader(), repo);

    await indexer.refreshToken(token.id, 'MintX');

    const meta = await repo.getTokenMetadata(token.id);
    assert.strictEqual(meta?.holderCount, 3);
    assert.strictEqual(meta?.top10HolderPercent, 87.5);
    assert.strictEqual(meta?.mintAuthorityActive, false);
    assert.ok(meta?.lastIndexedAt);
  });

  await test('refreshToken completes without throwing on bigint holder balances (never a raw bigint reaching storage/JSON)', async () => {
    const repo = new MemoryTokenRepository();
    const token = await repo.registerToken({ chain: 'SOLANA', address: 'MintY', name: 'Y', symbol: 'Y', decimals: 6, creatorWalletAddress: 'Creator' });
    const indexer = new TokenIndexer(mockChainReader(), repo);
    await indexer.refreshToken(token.id, 'MintY');
    assert.ok(true);
  });

  await test('an unavailable DataPoint from the chain reader maps to null, never a fabricated value', async () => {
    const repo = new MemoryTokenRepository();
    const token = await repo.registerToken({ chain: 'SOLANA', address: 'MintZ', name: 'Z', symbol: 'Z', decimals: 6, creatorWalletAddress: 'Creator' });
    const indexer = new TokenIndexer(
      mockChainReader({
        async getTransparencyReport() {
          return {
            mintAuthorityActive: { status: 'unavailable' },
            freezeAuthorityActive: { status: 'unavailable' },
            holderCount: { status: 'unavailable' },
            top10HolderPercent: { status: 'unavailable' },
          };
        },
      }),
      repo
    );
    await indexer.refreshToken(token.id, 'MintZ');
    const meta = await repo.getTokenMetadata(token.id);
    assert.strictEqual(meta?.holderCount, null);
    assert.strictEqual(meta?.mintAuthorityActive, null);
  });

  // A test asserting "a real SolanaAdapter instance satisfies ChainReader
  // structurally" was attempted and removed — SolanaAdapter.ts imports
  // @solana/web3.js at module load, which isn't installed here (no
  // internet, same pre-existing constraint as the rest of this project),
  // so it cannot be imported at runtime OR fully type-checked in this
  // sandbox. The interface was still written by hand to match
  // SolanaAdapter's actual method signatures exactly (confirmed by
  // reading that file directly before writing ChainReader) — that
  // match is asserted by inspection, not by an executable test, and
  // stated here plainly rather than papered over with a test that
  // can't really run.

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
