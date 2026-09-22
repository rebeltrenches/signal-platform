const RPC_URLS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" },
  });
}

function validSignedTransaction(value) {
  return typeof value === "string" && value.length >= 100 && value.length <= 16_000
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export async function submitSolanaSwap({ body }) {
  if (!validSignedTransaction(body?.signedTransaction)) {
    return { status: 400, body: { error: "INVALID_SIGNED_TRANSACTION", message: "A valid signed transaction is required." } };
  }
  for (const rpcUrl of RPC_URLS) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [body.signedTransaction, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (typeof payload?.result === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(payload.result)) {
        return { status: 200, body: { signature: payload.result, status: "submitted" } };
      }
      if (payload?.error) {
        return { status: 422, body: { error: "TRANSACTION_REJECTED", message: payload.error.message || "The network rejected the transaction." } };
      }
    } catch { /* Try the fallback RPC. */ }
  }
  return { status: 502, body: { error: "SUBMISSION_UNAVAILABLE", message: "Transaction submission is temporarily unavailable. The transaction was not re-signed." } };
}

export async function onRequestPost({ request }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 24_000) return json(413, { error: "BODY_TOO_LARGE", message: "Request body is too large." });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "INVALID_JSON", message: "Request body must be valid JSON." });
  }
  const result = await submitSolanaSwap({ body });
  return json(result.status, result.body);
}
