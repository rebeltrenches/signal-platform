import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection(process.env.SIGNAL_RUNTIME_RPC || 'http://127.0.0.1:8899', 'confirmed');
const config = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');
const expectedOwner = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
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
if (index !== 0) throw new Error(`Expected Raydium config index 0, got ${index}.`);
if (createPoolFee === 0n) throw new Error('Raydium create-pool fee unexpectedly decoded as zero.');

console.log(`Raydium config index: ${index}`);
console.log(`Raydium trade_fee_rate: ${tradeFeeRate} / 1,000,000`);
console.log(`Raydium protocol_fee_rate: ${protocolFeeRate} / 1,000,000 of trade fee`);
console.log(`Raydium fund_fee_rate: ${fundFeeRate} / 1,000,000 of trade fee`);
console.log(`Raydium create_pool_fee: ${createPoolFee} lamports`);
console.log(`Raydium creator_fee_rate: ${creatorFeeRate} / 1,000,000`);
console.log('✓ Raydium public AMM configuration layout decoded and creation is enabled');
