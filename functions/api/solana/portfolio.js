const RPC_URLS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function isSolanaAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > 0n) {
    bytes += 1;
    decoded >>= 8n;
  }
  let leadingZeroes = 0;
  for (const char of value) {
    if (char !== "1") break;
    leadingZeroes += 1;
  }
  return bytes + leadingZeroes === 32;
}

async function rpc(method, params) {
  let lastError = new Error("RPC_HTTP_ERROR");
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        lastError = new Error("RPC_HTTP_ERROR");
        continue;
      }
      const payload = await response.json();
      if (payload?.error || payload?.result === undefined) {
        lastError = new Error("RPC_RESPONSE_ERROR");
        continue;
      }
      return payload.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("RPC_HTTP_ERROR");
    }
  }
  throw lastError;
}

export async function onRequestPost({ request }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8192) return json(413, { error: "Request body too large", code: "BODY_TOO_LARGE" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body", code: "INVALID_JSON" });
  }

  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!isSolanaAddress(address)) return json(400, { error: "Invalid Solana wallet address", code: "INVALID_ADDRESS" });

  try {
    const balance = await rpc("getBalance", [address, { commitment: "confirmed" }]);
    const tokenResults = await Promise.allSettled([
      rpc("getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed", commitment: "confirmed" }]),
      rpc("getTokenAccountsByOwner", [address, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed", commitment: "confirmed" }]),
    ]);
    const tokens = tokenResults
      .flatMap((result) => result.status === "fulfilled" ? (result.value?.value || []) : [])
      .map((entry) => {
        const info = entry?.account?.data?.parsed?.info;
        const amount = info?.tokenAmount?.uiAmountString;
        return info?.mint && amount && amount !== "0" ? { mint: info.mint, amount } : null;
      })
      .filter(Boolean);

    return json(200, {
      lamports: Number(balance?.value || 0),
      tokens,
      tokenDataComplete: tokenResults.every((result) => result.status === "fulfilled"),
    });
  } catch (error) {
    const code = error instanceof Error && error.message === "RPC_HTTP_ERROR"
      ? "RPC_HTTP_ERROR"
      : "RPC_RESPONSE_ERROR";
    return json(502, { error: "Live Solana balances are temporarily unavailable", code });
  }
}

export function onRequest() {
  return json(405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
}
