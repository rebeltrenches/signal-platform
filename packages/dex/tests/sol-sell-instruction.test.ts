import assert from 'node:assert';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { deriveSolSellSettlementAccounts, SELL_RECEIPT_SEED, SELL_SETTLEMENT_SEED } from '../src/sol-sell-accounts.js';
import { buildCreateSolSellSettlementAccountInstruction, buildSolSellSettlementInstruction, SETTLE_SELL_INSTRUCTION } from '../src/sol-sell-instruction.js';

const TRADE_ID = '11'.repeat(32);
let passed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; } }

test('SELL accounts derive unique trade-specific program PDA and replay receipt', () => {
  const program = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  const accounts = deriveSolSellSettlementAccounts({
    programId: program.toBase58(), creatorAddress: creator.toBase58(), traderAddress: trader.toBase58(), tradeId: TRADE_ID,
  });
  const tradeId = Buffer.from(TRADE_ID, 'hex');
  const [authority] = PublicKey.findProgramAddressSync(
    [SELL_SETTLEMENT_SEED, trader.toBuffer(), creator.toBuffer(), tradeId], program,
  );
  const [receipt] = PublicKey.findProgramAddressSync(
    [SELL_RECEIPT_SEED, trader.toBuffer(), creator.toBuffer(), tradeId], program,
  );
  assert.ok(accounts.authority.equals(authority));
  assert.ok(accounts.receipt.equals(receipt));
});

test('different trade IDs derive different settlement and receipt accounts', () => {
  const program = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const trader = Keypair.generate().publicKey.toBase58();
  const a = deriveSolSellSettlementAccounts({ programId: program, creatorAddress: creator, traderAddress: trader, tradeId: '11'.repeat(32) });
  const b = deriveSolSellSettlementAccounts({ programId: program, creatorAddress: creator, traderAddress: trader, tradeId: '22'.repeat(32) });
  assert.ok(!a.authority.equals(b.authority));
  assert.ok(!a.settlementWsolAccount.equals(b.settlementWsolAccount));
  assert.ok(!a.receipt.equals(b.receipt));
});

test('create instruction is non-idempotent ATA creation funded by trader', () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const creatorAddress = Keypair.generate().publicKey.toBase58();
  const traderAddress = Keypair.generate().publicKey.toBase58();
  const accounts = deriveSolSellSettlementAccounts({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID });
  const ix = buildCreateSolSellSettlementAccountInstruction({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID });
  assert.ok(ix.keys[0]!.pubkey.equals(accounts.trader));
  assert.ok(ix.keys[1]!.pubkey.equals(accounts.settlementWsolAccount));
  assert.ok(ix.keys[2]!.pubkey.equals(accounts.authority));
});

test('settlement binds receipt, wallets, trader signature, token/system programs and trade ID', () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const creatorAddress = Keypair.generate().publicKey.toBase58();
  const traderAddress = Keypair.generate().publicKey.toBase58();
  const accounts = deriveSolSellSettlementAccounts({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID });
  const ix = buildSolSellSettlementInstruction({ programId, creatorAddress, traderAddress, tradeId: TRADE_ID });
  assert.equal(ix.data.length, 33);
  assert.equal(ix.data[0], SETTLE_SELL_INSTRUCTION);
  assert.deepStrictEqual([...ix.data.subarray(1)], [...Buffer.from(TRADE_ID, 'hex')]);
  assert.ok(ix.keys[2]!.pubkey.equals(accounts.receipt));
  assert.equal(ix.keys[4]!.isSigner, true);
  assert.ok(ix.keys[6]!.pubkey.equals(TOKEN_PROGRAM_ID));
  assert.ok(ix.keys[7]!.pubkey.equals(SystemProgram.programId));
});

test('invalid or short trade IDs fail closed', () => {
  assert.throws(() => deriveSolSellSettlementAccounts({
    programId: Keypair.generate().publicKey.toBase58(),
    creatorAddress: Keypair.generate().publicKey.toBase58(),
    traderAddress: Keypair.generate().publicKey.toBase58(),
    tradeId: 'abcd',
  }));
});

console.log(`${passed} test(s) passed.`);
