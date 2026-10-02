import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSolanaSwap } from "../../../functions/api/solana/swap-build.js";
import { submitSolanaSwap } from "../../../functions/api/solana/swap-submit.js";
import worker from "../../../worker.js";

const TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg";
const PROGRAM = "11111111111111111111111111111111";
const instruction = { programId: PROGRAM, accounts: [], data: "AA==" };
const clientSource = await readFile("apps/web/src/client/swap-execute.js", "utf8");
const buildSource = await readFile("apps/web/scripts/build.tsx", "utf8");
const tradeRouterSource = await readFile("apps/web/src/client/trade-router.js", "utf8");
assert.match(clientSource, /new URL\(RPC_PROXY, window\.location\.origin\)\.toString\(\)/);
assert.doesNotMatch(clientSource, /new web3\.Connection\(RPC_PROXY/);
assert.match(clientSource, /transactionIntentDifference\(finalMessage, signed\.message, tables\)/);
assert.doesNotMatch(clientSource, /sameBytes\(originalMessage, signed\.message\.serialize\(\)\)/);
// The tamper check itself lives in swap-intent.js (tested in swap-intent.test.mjs).
assert.match(clientSource, /import \{ createIntentCheck \} from "\.\/swap-intent\.js\?v=lighthouse-guard-1"/);
assert.match(clientSource, /const transactionIntentDifference = createIntentCheck\(web3\)/);
assert.match(clientSource, /throw new Error\(`Wallet changed transaction \$\{intentDifference\}; submission stopped\.`\)/);
assert.match(clientSource, /getLatestBlockhash\("confirmed"\)/);
assert.match(clientSource, /recentBlockhash: latestBlockhash\.blockhash/);
assert.match(clientSource, /latestBlockhash\.lastValidBlockHeight/);
assert.match(clientSource, /Check transaction on Solscan/);
assert.match(clientSource, /Submitted — verify on Solscan/);
assert.match(clientSource, /Signal could not verify confirmation yet/);
assert.match(clientSource, /status = await connection\.getSignatureStatus/);
assert.doesNotMatch(clientSource, /waitForConfirmation\(connection, submitted\.signature, build\.blockhashWithMetadata\.lastValidBlockHeight\)/);
assert.match(buildSource, /\/client\/curve-provenance\.js/);
assert.match(buildSource, /\/client\/trade-router\.js/);
assert.match(tradeRouterSource, /import\("\.\/swap-execute\.js\?v=swap-confirmation-retry-8"\)/);
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
