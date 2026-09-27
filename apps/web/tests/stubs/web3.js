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
//   blockhashNotFoundOnce     - the first exact-message simulation reports BlockhashNotFound
//   sendBlockhashNotFoundOnce - the first send throws "Blockhash not found"
//   metadataAccountMissing    - getAccountInfo finds no token metadata account
//   metadataMutable           - the read-back metadata account says isMutable
//   metadataNameOnChain       - the read-back metadata account shows this name

// Instructions carry programId/keys/data like real ones (what
// launch-integrity.js compares), plus `type` for the tests to read.
export function stubInstruction(program, type, fields = {}) {
  return {
    type,
    ...fields,
    programId: new PublicKey(program),
    keys: [],
    data: new TextEncoder().encode(JSON.stringify({ type, ...fields })),
  };
}

class StubTransaction {
  constructor() { this.instructions = []; }
  add(...ix) { this.instructions.push(...ix); return this; }
  partialSign() { this.partiallySigned = true; window.__t.partialSigns = (window.__t.partialSigns || 0) + 1; }
  verifySignatures() { return !window.__t.missingSignature; }
  // A copy, like the real (separate) Message object: later edits to the
  // transaction don't change an already compiled message.
  compileMessage() {
    return { instructions: [...this.instructions], recentBlockhash: this.recentBlockhash, feePayer: this.feePayer };
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

export class TransactionMessage {
  static decompile(message) {
    return { payerKey: message.feePayer, recentBlockhash: message.recentBlockhash, instructions: message.instructions };
  }
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
    if (config?.replaceRecentBlockhash === false && window.__t.blockhashNotFoundOnce) {
      window.__t.blockhashNotFoundOnce = false;
      return { value: { err: 'BlockhashNotFound', unitsConsumed: 0 } };
    }
    return { value: { err: window.__t.failSimulation || null, unitsConsumed: 5000 } };
  }
  // A token metadata account in the real layout, built from the
  // CreateMetadataAccountV3 instruction the launch sent for this address.
  async getAccountInfo(address) {
    const call = (window.__t.createMetadataCalls || []).find((c) => c.metadata === address.toBase58());
    if (!call || window.__t.metadataAccountMissing) return null;
    const utf8 = new TextEncoder();
    const padded = (value, max) => {
      const out = new Uint8Array(4 + max);
      new DataView(out.buffer).setUint32(0, max, true);
      out.set(utf8.encode(value), 4);
      return out;
    };
    const parts = [
      Uint8Array.of(4), new Uint8Array(32), new Uint8Array(32),
      padded(window.__t.metadataNameOnChain ?? call.name, 32), padded(call.symbol, 10), padded(call.uri, 200),
      Uint8Array.of(0, 0, 0, 0, window.__t.metadataMutable ? 1 : call.isMutable ? 1 : 0),
    ];
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) { data.set(p, offset); offset += p.length; }
    return { owner: new PublicKey(METADATA_PROGRAM), data, lamports: 13733800 };
  }
  async sendRawTransaction() {
    (window.__t.events = window.__t.events || []).push('send');
    window.__t.sendAttempts = (window.__t.sendAttempts || 0) + 1;
    if (window.__t.sendBlockhashNotFoundOnce) {
      window.__t.sendBlockhashNotFoundOnce = false;
      throw new Error('failed to send transaction: Transaction simulation failed: Blockhash not found');
    }
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

const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
// toBytes() output -> the stub key's string, so findProgramAddressSync can
// name the metadata account after its mint.
const keysByBytes = new Map();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export class PublicKey {
  constructor(v) { this.v = v; }
  toBase58() { return typeof this.v === 'string' ? this.v : 'STUB'; }
  toJSON() { return this.toBase58(); }
  equals(o) { return this.toBase58() === (o && o.toBase58 ? o.toBase58() : o); }
  toBytes() {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode(this.toBase58()).slice(0, 32));
    keysByBytes.set(hex(bytes), this.toBase58());
    return bytes;
  }
  static findProgramAddressSync(seeds, programId) {
    const seedKey = keysByBytes.get(hex(seeds[seeds.length - 1])) ?? 'UNKNOWN';
    return [new PublicKey(`PDA_${programId.toBase58().slice(0, 4)}_${seedKey}`), 255];
  }
}

// Decodes CreateMetadataAccountV3 data (Borsh) so tests can read what
// the launch asked the Token Metadata program to write.
function decodeCreateMetadata(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 1;
  const str = () => {
    const length = view.getUint32(offset, true);
    offset += 4;
    const value = new TextDecoder().decode(data.slice(offset, offset + length));
    offset += length;
    return value;
  };
  const name = str(), symbol = str(), uri = str();
  const sellerFeeBasisPoints = view.getUint16(offset, true);
  offset += 2;
  const [creators, collection, uses, isMutable, collectionDetails] = data.slice(offset, offset + 5);
  return { discriminator: data[0], name, symbol, uri, sellerFeeBasisPoints, creators, collection, uses, isMutable: isMutable === 1, collectionDetails, trailing: data.length - offset - 5 };
}

export class TransactionInstruction {
  constructor({ keys, programId, data }) {
    this.keys = keys;
    this.programId = programId;
    this.data = data;
    this.type = 'unknown';
    if (programId.toBase58() === METADATA_PROGRAM) {
      this.type = 'createMetadata';
      (window.__t.createMetadataCalls = window.__t.createMetadataCalls || []).push({
        ...decodeCreateMetadata(data),
        metadata: keys[0].pubkey.toBase58(),
        mint: keys[1].pubkey.toBase58(),
        keys: keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      });
    }
  }
}

export class Keypair {
  static generate() { return { publicKey: new PublicKey('STUB_NEW_MINT_' + Math.random().toString(36).slice(2, 8)) }; }
}

export class SystemProgram {
  static get programId() { return new PublicKey(SYSTEM_PROGRAM); }
  static transfer(args) {
    window.__t.transferCall = { to: args.toPubkey.toBase58(), lamports: args.lamports };
    (window.__t.transferCalls = window.__t.transferCalls || []).push(window.__t.transferCall);
    return stubInstruction(SYSTEM_PROGRAM, 'transfer', { to: args.toPubkey.toBase58(), lamports: args.lamports });
  }
  static createAccount(args) { return stubInstruction(SYSTEM_PROGRAM, 'createAccount', { space: args.space, lamports: args.lamports }); }
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

// Real Compute Budget data layout (launch-integrity.js decodes it).
export class ComputeBudgetProgram {
  static get programId() { return new PublicKey(COMPUTE_BUDGET_PROGRAM); }
  static setComputeUnitLimit({ units }) {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return { type: 'computeUnitLimit', units, programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [], data };
  }
  static setComputeUnitPrice({ microLamports }) {
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true);
    return { type: 'computeUnitPrice', microLamports, programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [], data };
  }
}
