import type { Handler } from '../router.js';
import { getWalletIntelligence } from '../wallets/walletIntelligenceStore.js';

const SUPPORTED_CHAINS = new Set(['SOLANA', 'BASE', 'BNB']);

export const getWalletIntelligenceRoute: Handler = async (req) => {
  const chain = (req.params.chain ?? '').toUpperCase();
  const address = (req.params.address ?? '').trim();

  if (!SUPPORTED_CHAINS.has(chain)) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'chain must be SOLANA, BASE, or BNB.' } };
  }
  if (!address) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'wallet address is required.' } };
  }

  const wallet = await getWalletIntelligence(chain, address);
  if (!wallet) {
    return { status: 404, body: { error: 'NOT_FOUND', message: 'No indexed wallet intelligence is available for this address.' } };
  }

  return {
    status: 200,
    body: {
      wallet,
      evidencePolicy: {
        ownershipInference: false,
        note: 'Relationships are observations with explicit evidence; they do not claim common ownership or identity.',
      },
    },
  };
};
