import assert from 'node:assert';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { deriveSolSellSettlementAccounts, WRAPPED_SOL_MINT, SELL_SETTLEMENT_SEED } from '../src/sol-sell-accounts.js';
import { buildSolSellSettlementInstruction, SETTLE_SELL_INSTRUCTION } from '../src/sol-sell-instruction.js';

let passed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (err) { console.error(`FAILED: ${name}`); throw err; } }

test('SELL accounts derive program PDA and wallet-bound WSOL ATAs', () => {
  const program = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  const accounts = deriveSolSellSettlementAccounts({
    programId: program.toBase58(), creatorAddress: creator.toBase58(), traderAddress: trader.toBase58(),
  });
  const [authority] = PublicKey.findProgramAddressSync([SELL_SETTLEMENT_SEED], program);
  assert.ok(accounts.authority.equals(authority));
  assert.ok(accounts.creatorWsolAccount.equals(getAssociatedTokenAddressSync(WRAPPED_SOL_MINT, creator)));
  assert.ok(accounts.traderWsolAccount.equals(getAssociatedTokenAddressSync(WRAPPED_SOL_MINT, trader)));
});

test('SELL instruction binds creator wallet and requires trader signature', () => {
  const program = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const trader = Keypair.generate().publicKey;
  const ix = buildSolSellSettlementInstruction({
    programId: program.toBase58(), creatorAddress: creator.toBase58(), traderAddress: trader.toBase58(),
  });
  assert.deepStrictEqual([...ix.data], [SETTLE_SELL_INSTRUCTION]);
  assert.ok(ix.keys[4].pubkey.equals(creator));
  assert.ok(ix.keys[5].pubkey.equals(trader));
  assert.equal(ix.keys[5].isSigner, true);
});

console.log(`${passed} test(s) passed.`);
