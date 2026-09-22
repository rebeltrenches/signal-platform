const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_U64 = 18446744073709551615n;
const SIGNAL_FEE_BPS = 100n;

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

function validInstruction(value) {
  return value && isSolanaAddress(value.programId) && Array.isArray(value.accounts)
    && value.accounts.length <= 128 && value.accounts.every((account) =>
      isSolanaAddress(account?.pubkey)
      && typeof account.isSigner === "boolean"
      && typeof account.isWritable === "boolean")
    && typeof value.data === "string" && value.data.length <= 12_000;
}

function validBuild(value) {
  const instructionLists = [value?.computeBudgetInstructions, value?.setupInstructions, value?.otherInstructions];
  return value && instructionLists.every((list) => Array.isArray(list) && list.length <= 24 && list.every(validInstruction))
    && validInstruction(value.swapInstruction)
    && (value.cleanupInstruction == null || validInstruction(value.cleanupInstruction))
    && value.tipInstruction == null
    && value.blockhashWithMetadata
    && Array.isArray(value.blockhashWithMetadata.blockhash)
    && value.blockhashWithMetadata.blockhash.length === 32
    && Number.isSafeInteger(value.blockhashWithMetadata.lastValidBlockHeight)
    && (value.addressesByLookupTableAddress == null || typeof value.addressesByLookupTableAddress === "object");
}

export async function buildSolanaSwap({ body, apiKey }) {
  const tokenMint = typeof body?.tokenMint === "string" ? body.tokenMint.trim() : "";
  const taker = typeof body?.taker === "string" ? body.taker.trim() : "";
  const grossAmount = parseAmount(body?.amount);
  if (!isSolanaAddress(tokenMint) || tokenMint === WRAPPED_SOL_MINT) {
    return { status: 400, body: { error: "INVALID_TOKEN_MINT", message: "Provide a valid Solana token mint." } };
  }
  if (!isSolanaAddress(taker)) {
    return { status: 400, body: { error: "INVALID_TAKER", message: "Connect a valid Solana wallet." } };
  }
  if (!grossAmount) {
    return { status: 400, body: { error: "INVALID_AMOUNT", message: "Amount must be a positive integer in lamports." } };
  }
  if (!apiKey) {
    return { status: 503, body: { error: "SWAP_SERVICE_NOT_CONFIGURED", message: "Swap execution is not configured." } };
  }

  const signalFeeLamports = grossAmount * SIGNAL_FEE_BPS / 10_000n;
  const routedAmount = grossAmount - signalFeeLamports;
  if (signalFeeLamports <= 0n || routedAmount <= 0n) {
    return { status: 422, body: { error: "AMOUNT_TOO_SMALL", message: "Amount is too small to calculate the Signal fee." } };
  }

  const params = new URLSearchParams({
    inputMint: WRAPPED_SOL_MINT,
    outputMint: tokenMint,
    amount: routedAmount.toString(),
    taker,
    slippageBps: "100",
    computeUnitPricePercentile: "veryHigh",
  });
  let response;
  try {
    response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: 502, body: { error: "SWAP_UPSTREAM_UNAVAILABLE", message: "Live swap building is temporarily unavailable." } };
  }
  const build = await response.json().catch(() => null);
  if (!response.ok || !validBuild(build)) {
    return { status: response.status === 429 ? 429 : 502, body: { error: "SWAP_BUILD_FAILED", message: "A signable market route could not be built." } };
  }

  return {
    status: 200,
    body: {
      transactionVersion: 0,
      inputMint: WRAPPED_SOL_MINT,
      outputMint: tokenMint,
      grossAmount: grossAmount.toString(),
      routedAmount: routedAmount.toString(),
      expectedOutput: build.outAmount,
      signalFeeLamports: signalFeeLamports.toString(),
      slippageBps: build.slippageBps,
      priceImpactPct: build.priceImpactPct ?? null,
      computeBudgetInstructions: build.computeBudgetInstructions,
      setupInstructions: build.setupInstructions,
      swapInstruction: build.swapInstruction,
      cleanupInstruction: build.cleanupInstruction,
      otherInstructions: build.otherInstructions,
      addressesByLookupTableAddress: build.addressesByLookupTableAddress,
      blockhashWithMetadata: build.blockhashWithMetadata,
      message: "Review the complete atomic swap and 1% SOL fee in Phantom before signing.",
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
  const result = await buildSolanaSwap({ body, apiKey: env?.JUPITER_API_KEY });
  return json(result.status, result.body);
}
