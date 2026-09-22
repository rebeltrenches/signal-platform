import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { SolanaFundingRelationshipWorker } from '../src/SolanaFundingRelationshipWorker.js';

const TARGET = '11111111111111111111111111111111';
const OTHER = 'Vote111111111111111111111111111111111111111';
const UPSTREAM = 'Stake11111111111111111111111111111111111111';

function transferTx(from: string, to: string, lamports: number, failed = false, blockTime: number | null = null): any {
  return {
    blockTime,
    meta: { err: failed ? { InstructionError: [0, 'Custom'] } : null },
    transaction: { message: { instructions: [{
      program: 'system',
      parsed: { type: 'transfer', info: { source: from, destination: to, lamports } },
    }] } },
  };
}

function unrelatedTx(): any {
  return {
    meta: { err: null },
    transaction: { message: { instructions: [
      { program: 'spl-token', parsed: { type: 'transfer', info: {} } },
    ] } },
  };
}

class MemoryDb {
  wallets = new Map<string, any>();
  relationships: any[] = [];
  wallet: any;
  walletRelationship: any;

  constructor() {
    this.wallet = {
      findUnique: async ({ where }: any) => this.wallets.get(where.address_chain.address) ?? null,
      create: async ({ data }: any) => {
        const row = { id: 'wallet-' + (this.wallets.size + 1), userId: null, ...data };
        this.wallets.set(data.address, row);
        return row;
      },
    };
    this.walletRelationship = {
      findFirst: async ({ where }: any) =>
        this.relationships.find((r) =>
          r.walletAId === where.walletAId &&
          r.walletBId === where.walletBId &&
          r.relationshipType === where.relationshipType &&
          r.observedTxSignature === where.observedTxSignature
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: 'rel-' + (this.relationships.length + 1), ...data };
        this.relationships.push(row);
        return row;
      },
    };
  }
}

async function main() {
  const db = new MemoryDb();
  const txs: Record<string, any> = {
    good: transferTx(TARGET, OTHER, 125000000, false, 1_700_000_000),
    failed: transferTx(TARGET, OTHER, 5, true),
    unrelated: unrelatedTx(),
  };
  const rpc = {
    async getSignaturesForAddress(address: PublicKey) {
      assert.equal(address.toBase58(), TARGET);
      return [
        { signature: 'good', err: null },
        { signature: 'failed', err: null },
        { signature: 'rpc-failed', err: { custom: 1 } },
        { signature: 'unrelated', err: null },
      ];
    },
    async getParsedTransaction(signature: string) { return txs[signature] ?? null; },
  };

  const worker = new SolanaFundingRelationshipWorker(rpc as any, db as any);
  const first = await worker.scanWallet(TARGET);
  assert.equal(first.scanned, 4);
  assert.equal(first.discovered, 1);
  assert.equal(db.relationships.length, 1);

  const relationship = db.relationships[0];
  assert.equal(relationship.relationshipType, 'funded');
  assert.equal(relationship.evidenceSource, 'BLOCKCHAIN_DERIVED');
  assert.equal(relationship.confidenceLevel, 'high');
  assert.equal(relationship.observedTxSignature, 'good');
  assert.equal(relationship.observedAt.toISOString(), '2023-11-14T22:13:20.000Z');
  assert.match(relationship.evidenceDescription, /125000000 lamports/);
  assert.ok(!('sameOwner' in relationship));
  assert.notEqual(relationship.relationshipType, 'same_owner_as');

  const second = await worker.scanWallet(TARGET);
  assert.equal(second.discovered, 0);
  assert.equal(db.relationships.length, 1, 'duplicate scan must be idempotent');

  const reverseDb = new MemoryDb();
  const reverseRpc = {
    async getSignaturesForAddress() { return [{ signature: 'incoming', err: null }]; },
    async getParsedTransaction() { return transferTx(OTHER, TARGET, 99); },
  };
  const reverse = new SolanaFundingRelationshipWorker(reverseRpc as any, reverseDb as any);
  await reverse.scanWallet(TARGET);
  assert.equal(reverseDb.relationships[0].walletAId, reverseDb.wallets.get(OTHER).id);
  assert.equal(reverseDb.relationships[0].walletBId, reverseDb.wallets.get(TARGET).id);

  const ancestryDb = new MemoryDb();
  const ancestryRpc = {
    async getSignaturesForAddress(address: PublicKey) {
      if (address.toBase58() === TARGET) return [{ signature: 'parent-to-root', err: null }];
      if (address.toBase58() === OTHER) return [{ signature: 'upstream-to-parent', err: null }];
      if (address.toBase58() === UPSTREAM) return [{ signature: 'cycle', err: null }];
      return [];
    },
    async getParsedTransaction(signature: string) {
      if (signature === 'parent-to-root') return transferTx(OTHER, TARGET, 10);
      if (signature === 'upstream-to-parent') return transferTx(UPSTREAM, OTHER, 20);
      if (signature === 'cycle') return transferTx(TARGET, UPSTREAM, 30);
      return null;
    },
  };
  const ancestry = new SolanaFundingRelationshipWorker(ancestryRpc as any, ancestryDb as any);
  const ancestryResult = await ancestry.scanFundingAncestry(TARGET, 3, 10);
  assert.equal(ancestryResult.walletsScanned, 3);
  assert.equal(ancestryResult.maxDepthReached, 2);
  assert.equal(ancestryResult.truncated, false);
  assert.equal(ancestryDb.relationships.length, 3);

  const cappedDb = new MemoryDb();
  const capped = new SolanaFundingRelationshipWorker(ancestryRpc as any, cappedDb as any);
  const cappedResult = await capped.scanFundingAncestry(TARGET, 3, 1);
  assert.equal(cappedResult.walletsScanned, 1);
  assert.equal(cappedResult.truncated, true);
  assert.equal(cappedDb.relationships.length, 1);

  console.log('solana-funding-relationship-worker: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
