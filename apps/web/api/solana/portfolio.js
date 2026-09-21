const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function send(res, status, body) {
  res.status(status).json(body);
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
  while (decoded > 0n) { bytes += 1; decoded >>= 8n; }
  let leadingZeroes = 0;
  for (const ch of value) { if (ch === "1") leadingZeroes += 1; else break; }
  return bytes + leadingZeroes === 32;
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
  if (!response.ok) throw new Error("upstream-http");
  const payload = await response.json();
  if (payload?.error || payload?.result === undefined) throw new Error("upstream-rpc");
  return payload.result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  if (!isSolanaAddress(address)) return send(res, 400, { error: "Invalid Solana wallet address" });

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) return send(res, 503, { error: "Live Solana balances are not configured" });

  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:") throw new Error("invalid-config");
  } catch {
    return send(res, 503, { error: "Live Solana balances are not configured" });
  }

  try {
    const [lamports, legacy, token2022] = await Promise.all([
      rpc(rpcUrl, "getBalance", [address, { commitment: "confirmed" }]),
      rpc(rpcUrl, "getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed", commitment: "confirmed" }]),
      rpc(rpcUrl, "getTokenAccountsByOwner", [address, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed", commitment: "confirmed" }]),
    ]);

    const accounts = [...(legacy?.value ?? []), ...(token2022?.value ?? [])];
    const tokens = accounts.map((entry) => {
      const info = entry?.account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.uiAmountString;
      return info?.mint && amount && amount !== "0" ? { mint: info.mint, amount } : null;
    }).filter(Boolean);

    return send(res, 200, { lamports: lamports?.value ?? 0, tokens });
  } catch {
    return send(res, 502, { error: "Live Solana balances are temporarily unavailable" });
  }
}
