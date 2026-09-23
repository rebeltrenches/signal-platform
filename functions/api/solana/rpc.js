const FALLBACK_RPC_URLS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const ALLOWED_METHODS = new Set(["simulateTransaction", "getSignatureStatuses", "getBlockHeight", "getLatestBlockhash"]);

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" },
  });
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 24_000) return json(413, { error: "RPC request is too large", code: "BODY_TOO_LARGE" });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON-RPC request", code: "INVALID_RPC_REQUEST" });
  }
  if (body?.jsonrpc !== "2.0" || !ALLOWED_METHODS.has(body?.method) || !Array.isArray(body?.params)) {
    return json(403, { error: "Solana RPC method is not allowed", code: "RPC_METHOD_NOT_ALLOWED" });
  }

  const urls = [];
  if (typeof env?.SOLANA_RPC_URL === "string" && env.SOLANA_RPC_URL.startsWith("https://")) urls.push(env.SOLANA_RPC_URL);
  urls.push(...FALLBACK_RPC_URLS);
  for (const rpcUrl of [...new Set(urls)]) {
    try {
      const upstream = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = upstream.ok ? await upstream.json().catch(() => null) : null;
      if (payload) return json(200, payload);
    } catch { /* Try the next RPC. */ }
  }
  return json(502, { error: "Solana RPC request failed", code: "RPC_UNAVAILABLE" });
}
