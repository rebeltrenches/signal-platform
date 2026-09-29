import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection(process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899', 'confirmed');
const config = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');
const expectedOwner = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const EXPECTED = {
  index: 0,
  tradeFeeRate: 2_500n,
  protocolFeeRate: 120_000n,
  fundFeeRate: 40_000n,
  createPoolFee: 150_000_000n,
  creatorFeeRate: 500n,
};

const info = await connection.getAccountInfo(config, 'confirmed');
if (!info) throw new Error('Raydium AMM config was not cloned.');
if (!info.owner.equals(expectedOwner)) throw new Error('Raydium AMM config owner mismatch.');
if (info.data.length < 116) throw new Error(`Raydium AMM config is unexpectedly short (${info.data.length} bytes).`);

const bytes = new Uint8Array(info.data.buffer, info.data.byteOffset, info.data.byteLength);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const read = (offset) => view.getBigUint64(offset, true);
const disableCreatePool = bytes[9] !== 0;
const index = new DataView(bytes.buffer, bytes.byteOffset + 10, 2).getUint16(0, true);
const tradeFeeRate = read(12);
const protocolFeeRate = read(20);
const fundFeeRate = read(28);
const createPoolFee = read(36);
const creatorFeeRate = read(108);

if (disableCreatePool) throw new Error('Selected Raydium AMM config currently disables new pool creation.');
if (index !== EXPECTED.index) throw new Error(`Raydium config index changed: expected ${EXPECTED.index}, got ${index}. Review before allowing Signal graduation.`);
if (tradeFeeRate !== EXPECTED.tradeFeeRate) throw new Error(`Raydium trade_fee_rate changed: expected ${EXPECTED.tradeFeeRate}, got ${tradeFeeRate}. Review before allowing Signal graduation.`);
if (protocolFeeRate !== EXPECTED.protocolFeeRate) throw new Error(`Raydium protocol_fee_rate changed: expected ${EXPECTED.protocolFeeRate}, got ${protocolFeeRate}. Review before allowing Signal graduation.`);
if (fundFeeRate !== EXPECTED.fundFeeRate) throw new Error(`Raydium fund_fee_rate changed: expected ${EXPECTED.fundFeeRate}, got ${fundFeeRate}. Review before allowing Signal graduation.`);
if (createPoolFee !== EXPECTED.createPoolFee) throw new Error(`Raydium create_pool_fee changed: expected ${EXPECTED.createPoolFee} lamports, got ${createPoolFee}. Review before allowing Signal graduation.`);
if (creatorFeeRate !== EXPECTED.creatorFeeRate) throw new Error(`Raydium creator_fee_rate changed: expected ${EXPECTED.creatorFeeRate}, got ${creatorFeeRate}. Review before allowing Signal graduation.`);

console.log(`Raydium config index: ${index}`);
console.log(`Raydium trade_fee_rate: ${tradeFeeRate} / 1,000,000`);
console.log(`Raydium protocol_fee_rate: ${protocolFeeRate} / 1,000,000 of trade fee`);
console.log(`Raydium fund_fee_rate: ${fundFeeRate} / 1,000,000 of trade fee`);
console.log(`Raydium create_pool_fee: ${createPoolFee} lamports`);
console.log(`Raydium creator_fee_rate: ${creatorFeeRate} / 1,000,000`);
console.log('✓ Raydium public AMM configuration exactly matches the reviewed Signal graduation configuration');
