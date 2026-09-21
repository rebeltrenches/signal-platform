import type { Handler } from '../router.js';
import { getFundingAncestry, getWalletIntelligence } from '../wallets/walletIntelligenceStore.js';

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

export const getWalletFundingAncestryRoute: Handler = async (req) => {
  const chain = (req.params.chain ?? '').toUpperCase();
  const address = (req.params.address ?? '').trim();
  const requestedDepth = Number(req.query.get('depth') ?? '3');

  if (!SUPPORTED_CHAINS.has(chain)) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'chain must be SOLANA, BASE, or BNB.' } };
  }
  if (!address) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'wallet address is required.' } };
  }
  if (!Number.isInteger(requestedDepth) || requestedDepth < 1 || requestedDepth > 6) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'depth must be an integer from 1 to 6.' } };
  }

  const ancestry = await getFundingAncestry(chain, address, requestedDepth);
  if (!ancestry) {
    return { status: 404, body: { error: 'NOT_FOUND', message: 'Funding ancestry storage is not available.' } };
  }
  return {
    status: 200,
    body: {
      ancestry,
      evidencePolicy: {
        ownershipInference: false,
        note: 'Funding ancestry shows observed transaction paths only; it does not claim common ownership or identity.',
      },
    },
  };
};
