import assert from "node:assert/strict";
import { buildSolanaSwap } from "../../../functions/api/solana/swap-build.js";
import { submitSolanaSwap } from "../../../functions/api/solana/swap-submit.js";
import worker from "../../../worker.js";

const TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19";
const PROGRAM = "11111111111111111111111111111111";
const instruction = { programId: PROGRAM, accounts: [], data: "AA==" };
const buildPayload = {
  outAmount: "25000000",
  slippageBps: 100,
  priceImpactPct: "0.001",
  computeBudgetInstructions: [instruction],
  setupInstructions: [],
  swapInstruction: instruction,
  cleanupInstruction: null,
  otherInstructions: [],
  tipInstruction: null,
  addressesByLookupTableAddress: null,
  blockhashWithMetadata: { blockhash: new Array(32).fill(1), lastValidBlockHeight: 123 },
};

const missingKey = await buildSolanaSwap({ body: { tokenMint: TOKEN, taker: TAKER, amount: "100000000" } });
assert.equal(missingKey.status, 503);

const originalFetch = globalThis.fetch;
const urls = [];
globalThis.fetch = async (url) => {
  urls.push(String(url));
  return Response.json(buildPayload);
};
try {
  const built = await buildSolanaSwap({
    body: { tokenMint: TOKEN, taker: TAKER, amount: "100000000" },
    apiKey: "test",
  });
  assert.equal(built.status, 200);
  assert.equal(built.body.signalFeeLamports, "1000000");
  assert.equal(built.body.routedAmount, "99000000");
  assert.ok(urls[0].includes("amount=99000000"));
  assert.ok(urls[0].includes(`taker=${TAKER}`));

  const statusResponse = await worker.fetch(new Request("https://signal.test/api/solana/swap/quote"), {
    JUPITER_API_KEY: "configured",
    ASSETS: { fetch: () => new Response("asset") },
  });
  assert.deepEqual(await statusResponse.json(), { configured: true, quoteEnabled: true, executionEnabled: true });
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => Response.json({ result: "5".repeat(88) });
try {
  const submitted = await submitSolanaSwap({ body: { signedTransaction: "A".repeat(200) } });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.status, "submitted");
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal((await submitSolanaSwap({ body: { signedTransaction: "bad" } })).status, 400);
console.log("swap-execution.test.mjs: all assertions passed");
