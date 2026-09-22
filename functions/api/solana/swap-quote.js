const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_U64 = 18446744073709551615n;
const RPC_URLS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

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

function parseAmount(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= MAX_U64 ? amount : null;
}

async function tokenDecimals(mint) {
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint, { commitment: "confirmed" }] }),
        signal: AbortSignal.timeout(5_000),
      });
      const payload = response.ok ? await response.json() : null;
      if (Number.isInteger(payload?.result?.value?.decimals)) return payload.result.value.decimals;
    } catch { /* Try the fallback RPC. */ }
  }
  return null;
}

export async function quoteSolanaSwap({ body, apiKey }) {
  const side = body?.side;
  const tokenMint = typeof body?.tokenMint === "string" ? body.tokenMint.trim() : "";
  const grossAmount = parseAmount(body?.amount);
  if (side !== "buy" && side !== "sell") {
    return { status: 400, body: { error: "INVALID_SIDE", message: "Side must be buy or sell." } };
  }
  if (!isSolanaAddress(tokenMint) || tokenMint === WRAPPED_SOL_MINT) {
    return { status: 400, body: { error: "INVALID_TOKEN_MINT", message: "Provide a valid Solana token mint." } };
  }
  if (!grossAmount) {
    return { status: 400, body: { error: "INVALID_AMOUNT", message: "Amount must be a positive integer in base units." } };
  }
  if (!apiKey) {
    return { status: 503, body: { error: "QUOTE_SERVICE_NOT_CONFIGURED", message: "Live swap quotes are not configured yet." } };
  }

  // BUY: split the trader's gross SOL before routing. SELL: quote the full
  // token amount, then split the actual SOL output when execution is built.
  const creatorFeeInput = side === "buy" ? grossAmount / 100n : 0n;
  const routedAmount = side === "buy" ? grossAmount - creatorFeeInput : grossAmount;
  if (routedAmount <= 0n || (side === "buy" && creatorFeeInput <= 0n)) {
    return { status: 422, body: { error: "AMOUNT_TOO_SMALL", message: "Amount is too small to calculate the creator fee." } };
  }

  const inputMint = side === "buy" ? WRAPPED_SOL_MINT : tokenMint;
  const outputMint = side === "buy" ? tokenMint : WRAPPED_SOL_MINT;
  const params = new URLSearchParams({ inputMint, outputMint, amount: routedAmount.toString() });
  let response;
  try {
    response = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: 502, body: { error: "QUOTE_UPSTREAM_UNAVAILABLE", message: "Live routing is temporarily unavailable." } };
  }
  const order = await response.json().catch(() => null);
  if (!response.ok || !order?.outAmount) {
    return { status: response.status === 429 ? 429 : 502, body: { error: "NO_ROUTE", message: "No executable market route is currently available for this amount." } };
  }

  const grossSolOutput = side === "sell" ? BigInt(order.outAmount) : null;
  const creatorFeeLamports = side === "buy" ? creatorFeeInput : grossSolOutput / 100n;
  const traderReceivesLamports = side === "sell" ? grossSolOutput - creatorFeeLamports : null;
  const decimals = await tokenDecimals(tokenMint);
  return {
    status: 200,
    body: {
      quoteOnly: true,
      executionEnabled: false,
      side,
      inputMint,
      outputMint,
      grossAmount: grossAmount.toString(),
      routedAmount: routedAmount.toString(),
      expectedOutput: order.outAmount,
      tokenDecimals: decimals,
      creatorFeeLamports: creatorFeeLamports.toString(),
      traderReceivesLamports: traderReceivesLamports?.toString() ?? null,
      router: order.router ?? "Jupiter",
      routeMode: order.mode ?? "quote",
      priceImpactPct: order.priceImpactPct ?? null,
      networkFeeLamports: order.signatureFeeLamports ?? null,
      jupiterFeeBps: order.feeBps ?? null,
      message: "Quote only. No transaction was created, signed, or submitted.",
    },
  };
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8192) return json(413, { error: "BODY_TOO_LARGE", message: "Request body is too large." });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "INVALID_JSON", message: "Request body must be valid JSON." });
  }
  const result = await quoteSolanaSwap({ body, apiKey: env?.JUPITER_API_KEY });
  return json(result.status, result.body);
}

export function onRequest() {
  return json(405, { error: "METHOD_NOT_ALLOWED", message: "Use POST." });
}
