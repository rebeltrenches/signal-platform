import assert from "node:assert/strict";
import { quoteSolanaSwap } from "../../../functions/api/solana/swap-quote.js";
import worker from "../../../worker.js";

const TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const statusResponse = await worker.fetch(new Request("https://signal.test/api/solana/swap/quote"), {
  ASSETS: { fetch: () => new Response("asset") },
});
assert.equal(statusResponse.status, 200);
assert.deepEqual(await statusResponse.json(), { configured: false, quoteEnabled: false, executionEnabled: false });

const missingKey = await quoteSolanaSwap({ body: { side: "buy", tokenMint: TOKEN, amount: "100000000" } });
assert.equal(missingKey.status, 503);
assert.equal(missingKey.body.error, "QUOTE_SERVICE_NOT_CONFIGURED");

const invalid = await quoteSolanaSwap({ body: { side: "buy", tokenMint: "not-a-mint", amount: "100" }, apiKey: "test" });
assert.equal(invalid.status, 400);

const originalFetch = globalThis.fetch;
const upstreamUrls = [];
globalThis.fetch = async (url) => {
  const upstreamUrl = String(url);
  upstreamUrls.push(upstreamUrl);
  if (upstreamUrl.startsWith("https://api.jup.ag/")) {
    return Response.json({ outAmount: "25000000", router: "metis", mode: "ultra", feeBps: 10 });
  }
  return Response.json({ result: { value: { decimals: 6 } } });
};
try {
  const quote = await quoteSolanaSwap({
    body: { side: "buy", tokenMint: TOKEN, amount: "100000000" },
    apiKey: "test",
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.creatorFeeLamports, "1000000");
  assert.equal(quote.body.routedAmount, "99000000");
  assert.equal(quote.body.executionEnabled, false);
  assert.equal(quote.body.tokenDecimals, 6);
  assert.ok(upstreamUrls.some((url) => url.includes("amount=99000000")));
  assert.ok(upstreamUrls.some((url) => url.includes("solana-rpc.publicnode.com")));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("swap-quote.test.mjs: all assertions passed");
