import type { Handler } from '../router.js';

// Exactly the RPC surface exercised by launch-solana.js. web3.js maps
// sendRawTransaction to sendTransaction and confirmTransaction to the two
// status/height methods below.
export const SOLANA_LAUNCH_RPC_METHODS = new Set([
  'getBlockHeight',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getSignatureStatuses',
  'sendTransaction',
  'simulateTransaction',
]);

export const proxySolanaRpc: Handler = async (req) => {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    return { status: 503, body: { error: 'Solana RPC is not configured', code: 'RPC_NOT_CONFIGURED' } };
  }
  try {
    if (new URL(rpcUrl).protocol !== 'https:') throw new Error('invalid');
  } catch {
    return { status: 503, body: { error: 'Solana RPC configuration is invalid', code: 'RPC_INVALID_CONFIG' } };
  }

  const body = req.body as { jsonrpc?: unknown; method?: unknown; params?: unknown } | undefined;
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || !Array.isArray(body.params)) {
    return { status: 400, body: { error: 'Invalid JSON-RPC request', code: 'INVALID_RPC_REQUEST' } };
  }
  if (!SOLANA_LAUNCH_RPC_METHODS.has(body.method)) {
    return { status: 403, body: { error: 'Solana RPC method is not allowed', code: 'RPC_METHOD_NOT_ALLOWED' } };
  }

  try {
    const upstream = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload) {
      return { status: 502, body: { error: 'Solana RPC request failed', code: 'RPC_HTTP_ERROR' } };
    }
    return { status: 200, body: payload };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'RPC_ERROR';
    console.error('Solana RPC proxy failure', { reason });
    return {
      status: 502,
      body: {
        error: 'Solana RPC request failed',
        code: reason === 'TimeoutError' ? 'RPC_TIMEOUT' : 'RPC_RESPONSE_ERROR',
      },
    };
  }
};
