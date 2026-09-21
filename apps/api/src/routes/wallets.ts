import type { Handler } from '../router.js';
import { getFundingAncestry, getSignalTrace, getWalletHistoryReplay, getWalletIntelligence } from '../wallets/walletIntelligenceStore.js';

const SUPPORTED_CHAINS = new Set(['SOLANA', 'BASE', 'BNB']);

function validateWalletTraceRequest(req: Parameters<Handler>[0]) {
  const chain = (req.params.chain ?? '').toUpperCase();
  const address = (req.params.address ?? '').trim();
  const requestedDepth = Number(req.query.get('depth') ?? '3');

  if (!SUPPORTED_CHAINS.has(chain)) {
    return { error: { status: 400, body: { error: 'VALIDATION_ERROR', message: 'chain must be SOLANA, BASE, or BNB.' } }, chain, address, requestedDepth };
  }
  if (!address) {
    return { error: { status: 400, body: { error: 'VALIDATION_ERROR', message: 'wallet address is required.' } }, chain, address, requestedDepth };
  }
  if (!Number.isInteger(requestedDepth) || requestedDepth < 1 || requestedDepth > 6) {
    return { error: { status: 400, body: { error: 'VALIDATION_ERROR', message: 'depth must be an integer from 1 to 6.' } }, chain, address, requestedDepth };
  }
  return { chain, address, requestedDepth };
}

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
  const parsed = validateWalletTraceRequest(req);
  if (parsed.error) return parsed.error;
  const { chain, address, requestedDepth } = parsed;

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

export const getWalletSignalTraceRoute: Handler = async (req) => {
  const parsed = validateWalletTraceRequest(req);
  if (parsed.error) return parsed.error;
  const { chain, address, requestedDepth } = parsed;

  const trace = await getSignalTrace(chain, address, requestedDepth);
  if (!trace) {
    return { status: 404, body: { error: 'NOT_FOUND', message: 'Signal Trace storage is not available.' } };
  }
  return { status: 200, body: { trace } };
};

export const getWalletHistoryReplayRoute: Handler = async (req) => {
  const parsed = validateWalletTraceRequest(req);
  if (parsed.error) return parsed.error;
  const { chain, address, requestedDepth } = parsed;

  const replay = await getWalletHistoryReplay(chain, address, requestedDepth);
  if (!replay) {
    return { status: 404, body: { error: 'NOT_FOUND', message: 'Wallet History Replay storage is not available.' } };
  }
  return { status: 200, body: { replay } };
};
