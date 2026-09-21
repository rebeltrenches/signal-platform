const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isSolanaAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const ch of value) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > 0n) {
    bytes += 1;
    decoded >>= 8n;
  }
  let leadingZeroes = 0;
  for (const ch of value) {
    if (ch === "1") leadingZeroes += 1;
    else break;
  }
  return bytes + leadingZeroes === 32;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    const error = new Error("upstream-http");
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  if (payload?.error || payload?.result === undefined) {
    const error = new Error("upstream-rpc");
    error.rpcCode = payload?.error?.code;
    throw error;
  }
  return payload.result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });

  const body = await readBody(req);
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!isSolanaAddress(address)) {
    return json(res, 400, { error: "Invalid Solana wallet address", code: "INVALID_ADDRESS" });
  }

  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    return json(res, 503, {
      error: "Live Solana balances are not configured",
      code: "RPC_NOT_CONFIGURED",
    });
  }

  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:") throw new Error("invalid-config");
  } catch {
    return json(res, 503, {
      error: "Live Solana balances are not configured",
      code: "RPC_INVALID_CONFIG",
    });
  }

  try {
    const balance = await rpc(rpcUrl, "getBalance", [address, { commitment: "confirmed" }]);

    const tokenResults = await Promise.allSettled([
      rpc(rpcUrl, "getTokenAccountsByOwner", [
        address,
        { programId: TOKEN_PROGRAM_ID },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
      rpc(rpcUrl, "getTokenAccountsByOwner", [
        address,
        { programId: TOKEN_2022_PROGRAM_ID },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
    ]);

    const accounts = tokenResults.flatMap((result) =>
      result.status === "fulfilled" ? (result.value?.value ?? []) : []
    );

    const tokens = accounts
      .map((entry) => {
        const info = entry?.account?.data?.parsed?.info;
        const amount = info?.tokenAmount?.uiAmountString;
        return info?.mint && amount && amount !== "0"
          ? { mint: info.mint, amount }
          : null;
      })
      .filter(Boolean);

    return json(res, 200, {
      lamports: Number(balance?.value ?? 0),
      tokens,
      tokenDataComplete: tokenResults.every((result) => result.status === "fulfilled"),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "upstream";
    const upstreamStatus = error && typeof error === "object" && "status" in error ? error.status : undefined;
    console.error("portfolio RPC failure", { reason, upstreamStatus });

    return json(res, 502, {
      error: "Live Solana balances are temporarily unavailable",
      code: reason === "upstream-http"
        ? "RPC_HTTP_ERROR"
        : reason === "TimeoutError"
          ? "RPC_TIMEOUT"
          : "RPC_RESPONSE_ERROR",
    });
  }
}
