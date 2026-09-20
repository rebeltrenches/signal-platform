/**
 * Direct unit tests for EvmAdapter — unlike SolanaAdapter.ts, this file
 * has zero external dependencies (no ethers/viem/@solana packages), so
 * it can be imported and tested directly rather than needing the
 * stub-module approach the Solana tests use. Tests real ABI
 * encoding/decoding against hand-computed hex values, and the ADR-0003
 * enforcement precisely — never run against a real Base/BNB RPC
 * endpoint (no internet exists anywhere this project has been built).
 *
 * Run with: npx tsx packages/blockchain/tests/EvmAdapter.test.ts
 */
import assert from 'node:assert';
import { EvmAdapter, type EvmProvider } from '../src/evm/EvmAdapter.js';

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

// A hand-encoded ABI string return for "Signal Test Token" — real
// Solidity ABI encoding for a dynamic string: 32-byte offset (0x20),
// 32-byte length, then the UTF-8 bytes right-padded to a 32-byte
// boundary. Computed by hand, not copied from the adapter under test.
function encodeAbiStringForTest(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  const lengthHex = bytes.length.toString(16).padStart(64, '0');
  let dataHex = bytes.toString('hex');
  const paddedLength = Math.ceil(bytes.length / 32) * 32;
  dataHex = dataHex.padEnd(paddedLength * 2, '0');
  const offsetHex = '20'.padStart(64, '0');
  return '0x' + offsetHex + lengthHex + dataHex;
}

function encodeUintForTest(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

function mockProvider(responses: Record<string, string>): EvmProvider {
  return {
    async call({ to, data }) {
      const selector = data.slice(0, 10);
      const key = `${to}:${selector}`;
      if (responses[key] !== undefined) return responses[key];
      if (responses[selector] !== undefined) return responses[selector];
      throw new Error(`No mock response for ${key}`);
    },
  };
}

const TOKEN_ADDRESS = '0x11111111111111111111111111111111111111';
const CREATOR_ADDRESS = '0x2222222222222222222222222222222222222b';

async function run() {
  await test('getTokenIdentity decodes real ABI-encoded name/symbol correctly', async () => {
    const provider = mockProvider({
      '0x06fdde03': encodeAbiStringForTest('Signal Test Token'),
      '0x95d89b41': encodeAbiStringForTest('STT'),
      '0x313ce567': encodeUintForTest(18n),
    });
    const adapter = new EvmAdapter('base' as any, provider, async () => null);
    const identity = await adapter.getTokenIdentity(TOKEN_ADDRESS);
    assert.strictEqual(identity?.name, 'Signal Test Token');
    assert.strictEqual(identity?.symbol, 'STT');
    assert.strictEqual(identity?.decimals, 18);
  });

  await test('getTokenIdentity reports launchedOnSignal as a real DataPoint, true only when actually registered', async () => {
    const provider = mockProvider({
      '0x06fdde03': encodeAbiStringForTest('X'),
      '0x95d89b41': encodeAbiStringForTest('X'),
      '0x313ce567': encodeUintForTest(18n),
    });
    const adapterUnregistered = new EvmAdapter('base' as any, provider, async () => null);
    const identity1 = await adapterUnregistered.getTokenIdentity(TOKEN_ADDRESS);
    assert.deepStrictEqual(identity1?.launchedOnSignal.status, 'available');
    assert.strictEqual((identity1?.launchedOnSignal as any).value, false);

    const adapterRegistered = new EvmAdapter('base' as any, provider, async () => ({ creatorWalletAddress: CREATOR_ADDRESS }));
    const identity2 = await adapterRegistered.getTokenIdentity(TOKEN_ADDRESS);
    assert.strictEqual((identity2?.launchedOnSignal as any).value, true);
  });

  await test('getTokenSupplyInfo: mintAuthorityActive is false and freezeAuthorityActive is null for a standard ERC20 (real facts about the standard, not a guess)', async () => {
    const provider = mockProvider({
      '0x18160ddd': encodeUintForTest(1_000_000n),
      '0x313ce567': encodeUintForTest(6n),
    });
    const adapter = new EvmAdapter('bnb' as any, provider, async () => null);
    const supply = await adapter.getTokenSupplyInfo(TOKEN_ADDRESS);
    assert.strictEqual(supply?.totalSupply, 1_000_000n);
    assert.strictEqual(supply?.mintAuthorityActive, false);
    assert.strictEqual(supply?.freezeAuthorityActive, null);
  });

  await test('getTopHolders is honestly empty, never fabricated', async () => {
    const adapter = new EvmAdapter('base' as any, mockProvider({}), async () => null);
    const holders = await adapter.getTopHolders(TOKEN_ADDRESS, 10);
    assert.deepStrictEqual(holders, []);
  });

  await test('getTransparencyReport computes a real creatorHoldingPercent from an actual balanceOf call', async () => {
    const provider = mockProvider({
      '0x18160ddd': encodeUintForTest(1000n),
      '0x313ce567': encodeUintForTest(18n),
      [`${TOKEN_ADDRESS}:0x70a08231`]: encodeUintForTest(250n), // creator holds 250 of 1000 = 25%
    });
    const adapter = new EvmAdapter('base' as any, provider, async () => ({ creatorWalletAddress: CREATOR_ADDRESS }));
    const report = await adapter.getTransparencyReport(TOKEN_ADDRESS);
    assert.strictEqual(report.creatorHoldingPercent.status, 'available');
    assert.strictEqual((report.creatorHoldingPercent as any).value, 25);
  });

  await test('buildCreateTokenTransaction THROWS when taxBps is set — ADR-0003 enforced in code, not just documented', async () => {
    const adapter = new EvmAdapter('base' as any, mockProvider({}), async () => null, {
      bytecode: '0x600a',
      encodeConstructorArgs: () => '0x',
    });
    await assert.rejects(
      () =>
        adapter.buildCreateTokenTransaction({
          name: 'X', symbol: 'X', decimals: 18, totalSupply: 1000n, launcherAddress: CREATOR_ADDRESS, taxBps: 300,
        }),
      /ADR-0003/
    );
  });

  await test('buildCreateTokenTransaction THROWS when no deployment artifact is supplied — never invents contract bytecode', async () => {
    const adapter = new EvmAdapter('base' as any, mockProvider({}), async () => null);
    await assert.rejects(
      () =>
        adapter.buildCreateTokenTransaction({
          name: 'X', symbol: 'X', decimals: 18, totalSupply: 1000n, launcherAddress: CREATOR_ADDRESS, taxBps: null,
        }),
      /deployment artifact/
    );
  });

  await test('buildCreateTokenTransaction succeeds with taxBps null and a real supplied artifact, and discloses no-fee honestly', async () => {
    const adapter = new EvmAdapter('base' as any, mockProvider({}), async () => null, {
      bytecode: '0x600a',
      encodeConstructorArgs: () => '0xabcdef',
    });
    const tx = await adapter.buildCreateTokenTransaction({
      name: 'Signal Coin', symbol: 'SIG', decimals: 18, totalSupply: 1_000_000n, launcherAddress: CREATOR_ADDRESS, taxBps: null,
    });
    assert.strictEqual(tx.chain, 'base');
    assert.ok((tx.opaquePayload as any).data.startsWith('0x600a'));
    assert.ok(tx.humanSummary.some((line) => line.includes('No transfer fee')));
  });

  await test('getTransactionStatus maps a successful receipt (status 0x1) to confirmed, and a missing receipt to confirming (a valid TxState)', async () => {
    const provider: EvmProvider = {
      async call() { return '0x'; },
      async getTransactionReceipt(hash) {
        return hash === 'pending-hash' ? null : { status: '0x1', blockNumber: '0x1' };
      },
    };
    const adapter = new EvmAdapter('base' as any, provider, async () => null);
    const confirmed = await adapter.getTransactionStatus('done-hash');
    assert.strictEqual(confirmed.state, 'confirmed');
    const pending = await adapter.getTransactionStatus('pending-hash');
    assert.strictEqual(pending.state, 'confirming');
  });

  console.log(`${passed} test(s) passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
