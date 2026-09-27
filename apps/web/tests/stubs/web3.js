// Test stub for @solana/web3.js — used by
// apps/web/tests/supply-validation-and-recovery.test.py.
// Provides just enough surface for launch-solana.js's ORCHESTRATION logic
// (validation, recovery, simulate/sign/submit/confirm ordering) to run
// against, recording what it is called with in window.__t. This does NOT
// verify the real @solana/web3.js library's behavior; the flow has been
// exercised against Solana Devnet separately.
//
// Test knobs on window.__t:
//   failSimulation      - simulateTransaction returns this as value.err
//   failConfirmOnCall   - the Nth confirmation check reports a failed tx
//   failConfirmError    - the err reported by that failed check
class StubTransaction {
  constructor() { this.instructions = []; }
  add(...ix) { this.instructions.push(...ix); return this; }
  partialSign() { this.partiallySigned = true; }
  compileMessage() {
    return { instructions: this.instructions, recentBlockhash: this.recentBlockhash, feePayer: this.feePayer };
  }
  serializeMessage() {
    const message = JSON.stringify({
      instructions: this.instructions,
      recentBlockhash: this.recentBlockhash,
    });
    return new TextEncoder().encode(message);
  }
  serialize() { return new Uint8Array([1, 2, 3]); }
}
export { StubTransaction as Transaction };

export class VersionedTransaction {
  constructor(message) { this.message = message; }
}

export class Connection {
  constructor(url) { window.__t.rpcUrl = url; }
  async getMinimumBalanceForRentExemption() { return 1461600; }
  async getLatestBlockhash() {
    window.__t.blockhashCount = (window.__t.blockhashCount || 0) + 1;
    return { blockhash: 'stub-blockhash-' + window.__t.blockhashCount, lastValidBlockHeight: 1000 };
  }
  async simulateTransaction(transaction, config) {
    // Same argument rule as the real library (web3.js 1.95.3): a config
    // object is only accepted alongside a VersionedTransaction.
    if (transaction instanceof StubTransaction && config !== undefined && !Array.isArray(config)) {
      throw new Error('Invalid arguments');
    }
    window.__t.simulations = window.__t.simulations || [];
    window.__t.simulations.push({
      types: transaction.message.instructions.map((ix) => ix.type),
      replaceRecentBlockhash: config?.replaceRecentBlockhash,
    });
    return { value: { err: window.__t.failSimulation || null, unitsConsumed: 5000 } };
  }
  async sendRawTransaction() {
    window.__t.submittedCount = (window.__t.submittedCount || 0) + 1;
    if (window.__t.forceSubmitError) throw new Error(window.__t.forceSubmitError);
    return 'sig-' + window.__t.submittedCount;
  }
  async getSignatureStatus(signature) {
    window.__t.confirmCallCount = (window.__t.confirmCallCount || 0) + 1;
    // Lets a test simulate "step N's transaction lands on-chain but
    // fails" — the create flow's confirmations happen in a fixed order
    // (mint, then supply), so "fail on call 2" means "fail the supply step".
    if (window.__t.failConfirmOnCall === window.__t.confirmCallCount) {
      return { value: { err: window.__t.failConfirmError || 'simulated failure', confirmationStatus: 'confirmed' } };
    }
    window.__t.confirmedSignatures = window.__t.confirmedSignatures || [];
    window.__t.confirmedSignatures.push(signature);
    return { value: { err: null, confirmationStatus: 'confirmed' } };
  }
  async getBlockHeight() { return 1; }
}

export class PublicKey {
  constructor(v) { this.v = v; }
  toBase58() { return typeof this.v === 'string' ? this.v : 'STUB'; }
  toJSON() { return this.toBase58(); }
  equals(o) { return this.toBase58() === (o && o.toBase58 ? o.toBase58() : o); }
}

export class Keypair {
  static generate() { return { publicKey: new PublicKey('STUB_NEW_MINT_' + Math.random().toString(36).slice(2, 8)) }; }
}

export class SystemProgram {
  static transfer(args) {
    window.__t.transferCall = { to: args.toPubkey.toBase58(), lamports: args.lamports };
    return { type: 'transfer', lamports: args.lamports };
  }
  static createAccount(args) { return { type: 'createAccount', space: args.space, lamports: args.lamports }; }
}

export class ComputeBudgetProgram {
  static setComputeUnitLimit({ units }) { return { type: 'computeUnitLimit', units }; }
  static setComputeUnitPrice({ microLamports }) { return { type: 'computeUnitPrice', microLamports }; }
}
