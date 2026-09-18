// Test stub for @solana/web3.js — used only by apps/web/tests/collect-fees.test.py.
// Provides just enough surface for collect-fees.js's ORCHESTRATION logic
// to run against, so the test can assert on real captured call
// parameters (which wallet, which destination, which instructions) —
// this does NOT verify the real @solana/web3.js library's own behavior,
// which can't be installed in this sandbox (no internet). See that
// test file's own header for exactly what this does and doesn't prove.
export class Connection {
  constructor(url) { window.__t.rpcUrl = url; }
  async getProgramAccounts(programId, opts) {
    return window.__t.fixtureAccounts || [];
  }
  async getMinimumBalanceForRentExemption() { return 1461600; }
  async getLatestBlockhash() { return { blockhash: 'stub-blockhash' }; }
  async sendRawTransaction() {
    window.__t.submittedCount = (window.__t.submittedCount || 0) + 1;
    if (window.__t.forceSubmitError) throw new Error(window.__t.forceSubmitError);
    return 'sig-' + window.__t.submittedCount;
  }
  async confirmTransaction(sig) {
    window.__t.confirmedSignatures = window.__t.confirmedSignatures || [];
    window.__t.confirmCallCount = (window.__t.confirmCallCount || 0) + 1;
    // Lets a test simulate "step N's transaction lands on-chain but
    // fails" (e.g. insufficient funds for rent) without needing to know
    // which named step that corresponds to — the create flow's calls
    // happen in a fixed, deterministic order (mint, then supply), so
    // "fail on call 2" reliably means "fail the supply-mint step".
    if (window.__t.failConfirmOnCall === window.__t.confirmCallCount) {
      return { value: { err: window.__t.failConfirmError || 'simulated failure' } };
    }
    window.__t.confirmedSignatures.push(sig);
    return { value: { err: window.__t.forceConfirmError || null } };
  }
}
export class PublicKey {
  constructor(v) { this.v = v; }
  toBase58() { return typeof this.v === 'string' ? this.v : 'STUB'; }
  equals(o) { return this.toBase58() === (o && o.toBase58 ? o.toBase58() : o); }
}
export class Keypair {
  static generate() { return { publicKey: new PublicKey('STUB_NEW_MINT_' + Math.random().toString(36).slice(2, 8)) }; }
}
export class SystemProgram {
  static createAccount(args) { return { type: 'createAccount', args }; }
}
export class Transaction {
  constructor() { this.instructions = []; }
  add(...ix) { this.instructions.push(...ix); return this; }
  partialSign() {}
  serialize() { return new Uint8Array([1, 2, 3]); }
}
