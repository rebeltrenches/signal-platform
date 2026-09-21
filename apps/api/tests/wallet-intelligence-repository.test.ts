import assert from 'node:assert/strict';
import { PrismaWalletIntelligenceRepository } from '../src/wallets/PrismaWalletIntelligenceRepository.js';

async function run() {
  let walletQuery: any;
  let holderQuery: any;
  let firstActivityQuery: any;
  const db: any = {
    wallet: {
      findUnique: async (args: any) => {
        walletQuery = args;
        return {
          id: 'w1', address: 'WalletA', chain: 'SOLANA',
          createdTokens: [{ id:'t1', chain:'SOLANA', address:'Mint1', name:'One', symbol:'ONE', decimals:6, createdAt:new Date('2026-01-02T00:00:00Z') }],
          activity: [{ id:'a2', kind:'large_transfer', tokenId:'t1', usdValue:null, occurredAt:new Date('2026-01-03T00:00:00Z') }],
          relationshipsAsA: [{
            id:'r1', relationshipType:'funded', evidenceSource:'BLOCKCHAIN_DERIVED',
            evidenceDescription:'WalletA sent SOL to WalletB in transaction Sig1',
            confidenceLevel:'high', observedTxSignature:'Sig1', discoveredAt:new Date('2026-01-04T00:00:00Z'),
            walletB:{ address:'WalletB', chain:'SOLANA' },
          }],
          relationshipsAsB: [{
            id:'r2', relationshipType:'funded', evidenceSource:'BLOCKCHAIN_DERIVED',
            evidenceDescription:'WalletC sent SOL to WalletA in transaction Sig2',
            confidenceLevel:'high', observedTxSignature:'Sig2', discoveredAt:new Date('2026-01-02T00:00:00Z'),
            walletA:{ address:'WalletC', chain:'SOLANA' },
          }],
          notes: [],
        };
      },
    },
    walletActivity: {
      findFirst: async (args: any) => {
        firstActivityQuery = args;
        return { occurredAt: new Date('2025-12-01T00:00:00Z') };
      },
    },
    holder: {
      findMany: async (args: any) => {
        holderQuery = args;
        return [{
          balance: 123456n, lastUpdated:new Date('2026-01-05T00:00:00Z'),
          token:{ id:'t1', chain:'SOLANA', address:'Mint1', name:'One', symbol:'ONE', decimals:6 },
        }];
      },
    },
  };

  const repo = new PrismaWalletIntelligenceRepository(db);
  const result = await repo.getWallet('SOLANA', 'WalletA');
  assert.ok(result);
  assert.deepEqual(walletQuery.where, { address_chain: { address:'WalletA', chain:'SOLANA' } });
  assert.deepEqual(firstActivityQuery.orderBy, { occurredAt:'asc' });
  assert.deepEqual(holderQuery.where, { address:'WalletA', token:{ chain:'SOLANA' } });
  assert.equal(result.firstObservedActivity, '2025-12-01T00:00:00.000Z');
  assert.equal(result.holdings[0]?.balance, '123456');
  assert.equal(result.relationships[0]?.direction, 'outgoing');
  assert.equal(result.relationships[0]?.evidenceSource, 'BLOCKCHAIN_DERIVED');
  assert.equal(result.relationships[0]?.observedTxSignature, 'Sig1');
  assert.deepEqual(result.relationshipSummary, {
    directRelationshipCount: 2,
    incomingCount: 1,
    outgoingCount: 1,
    blockchainDerivedCount: 2,
    uniqueRelatedWalletCount: 2,
    transactionEvidenceCount: 2,
  });
  assert.equal((result as any).riskScore, undefined);
  assert.equal((result.relationships[0] as any).sameOwner, undefined);

  const missingDb: any = {
    wallet:{ findUnique: async () => null },
    walletActivity:{ findFirst: async () => { throw new Error('must not query activity for missing wallet'); } },
    holder:{ findMany: async () => { throw new Error('must not query holders for missing wallet'); } },
  };
  assert.equal(await new PrismaWalletIntelligenceRepository(missingDb).getWallet('SOLANA','Missing'), null);

  console.log('  ok  - wallet lookup is chain/address scoped');
  console.log('  ok  - first observed activity is queried independently of the 100-row activity window');
  console.log('  ok  - holder balances remain exact strings');
  console.log('  ok  - relationships preserve evidence and direction');
  console.log('  ok  - relationship summary counts only observable direct evidence');
  console.log('  ok  - no risk score or wallet-ownership inference is fabricated');
  console.log('  ok  - missing wallets return null without invented data');
  console.log('\n7 test(s) passed.');
}
run().catch((err) => { console.error(err); process.exit(1); });
