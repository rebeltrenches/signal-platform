function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    return json(res, 503, { error: "Solana RPC is not configured", code: "RPC_NOT_CONFIGURED" });
  }
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:") throw new Error("invalid");
  } catch {
    return json(res, 503, { error: "Solana RPC configuration is invalid", code: "RPC_INVALID_CONFIG" });
  }

  const body = await readBody(req);
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string" || !Array.isArray(body.params)) {
    return json(res, 400, { error: "Invalid JSON-RPC request", code: "INVALID_RPC_REQUEST" });
  }

  const allowedMethods = new Set([
    "getAccountInfo",
    "getBalance",
    "getBlockHeight",
    "getLatestBlockhash",
    "getMultipleAccounts",
    "getProgramAccounts",
    "getSignatureStatuses",
    "getTokenAccountBalance",
    "getTokenAccountsByOwner",
    "sendTransaction",
    "simulateTransaction",
  ]);
  if (!allowedMethods.has(body.method)) {
    return json(res, 403, { error: "Solana RPC method is not allowed", code: "RPC_METHOD_NOT_ALLOWED" });
  }

  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload) {
      return json(res, 502, { error: "Solana RPC request failed", code: "RPC_HTTP_ERROR" });
    }
    return json(res, 200, payload);
  } catch (error) {
    const reason = error instanceof Error ? error.name : "RPC_ERROR";
    console.error("Solana RPC proxy failure", { reason });
    return json(res, 502, {
      error: "Solana RPC request failed",
      code: reason === "TimeoutError" ? "RPC_TIMEOUT" : "RPC_RESPONSE_ERROR",
    });
  }
}
