import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { SolanaFundingRelationshipWorker } from '../src/SolanaFundingRelationshipWorker.js';

const TARGET = '11111111111111111111111111111111';
const OTHER = 'Vote111111111111111111111111111111111111111';

function transferTx(from: string, to: string, lamports: number, failed = false): any {
  return {
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
    good: transferTx(TARGET, OTHER, 125000000),
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

  console.log('solana-funding-relationship-worker: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
