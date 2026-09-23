import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("functions/api/solana/portfolio.js", "utf8");
const portfolio = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const methods = [];
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  methods.push(request.method);
  if (request.method === "getBalance") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: { value: 5_127_142 } });
  }
  return Response.json({ jsonrpc: "2.0", id: 1, result: { value: [] } });
};

const response = await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19" }),
  }),
  env: { SOLANA_RPC_URL: "https://configured-rpc.example" },
});
const body = await response.json();

assert.equal(response.status, 200);
assert.equal(body.lamports, 5_127_142);
assert.deepEqual(methods, ["getBalance", "getTokenAccountsByOwner", "getTokenAccountsByOwner"]);

const jupiterUrls = [];
globalThis.fetch = async (url, init) => {
  jupiterUrls.push(url);
  assert.equal(init.headers["x-api-key"], "test-jupiter-key");
  if (url.includes("/tokens/v2/search")) {
    return Response.json([
      { id: "D6jruVcKxnzR4gvvSJchN8WDPGv29rB4Hv7HewpGYGNE", name: "Signal Test", symbol: "SIGT" },
      { id: "8Er7zRjgvBNxzMgTY6Rq2wGp63YLx5uitueUUP8QUom3", name: "Community Coin", symbol: "COM" },
    ]);
  }
  return Response.json({
    amount: "4958999",
    uiAmount: 0.004958999,
    uiAmountString: "0.004958999",
    tokens: {
      D6jruVcKxnzR4gvvSJchN8WDPGv29rB4Hv7HewpGYGNE: [
        { account: "token-account-1", amount: "1171441157503", decimals: 6, uiAmount: 1171441.157503, uiAmountString: "1171441.157503" },
      ],
      "8Er7zRjgvBNxzMgTY6Rq2wGp63YLx5uitueUUP8QUom3": [
        { account: "token-account-2", amount: "553420613222526", decimals: 6, uiAmount: 553420613.222526, uiAmountString: "553420613.222526" },
      ],
    },
  });
};
const jupiterResponse = await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    body: JSON.stringify({ address: "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19" }),
  }),
  env: { JUPITER_API_KEY: "test-jupiter-key" },
});
const jupiterBody = await jupiterResponse.json();
assert.equal(jupiterResponse.status, 200);
assert.equal(jupiterBody.lamports, 4_958_999);
assert.equal(jupiterBody.tokenDataComplete, true);
assert.deepEqual(jupiterBody.tokens, [
  { mint: "D6jruVcKxnzR4gvvSJchN8WDPGv29rB4Hv7HewpGYGNE", amount: "1171441.157503", name: "Signal Test", symbol: "SIGT" },
  { mint: "8Er7zRjgvBNxzMgTY6Rq2wGp63YLx5uitueUUP8QUom3", amount: "553420613.222526", name: "Community Coin", symbol: "COM" },
]);
assert.equal(jupiterUrls[0], "https://api.jup.ag/ultra/v1/holdings/FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19");
assert.match(jupiterUrls[1], /^https:\/\/api\.jup\.ag\/tokens\/v2\/search\?query=/);

const requestedUrls = [];
globalThis.fetch = async (url, init) => {
  requestedUrls.push(url);
  const request = JSON.parse(init.body);
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: request.method === "getBalance" ? { value: 1 } : { value: [] },
  });
};
await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    body: JSON.stringify({ address: "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19" }),
  }),
  env: { SOLANA_RPC_URL: "https://configured-rpc.example" },
});
assert.deepEqual(requestedUrls, [
  "https://configured-rpc.example",
  "https://configured-rpc.example",
  "https://configured-rpc.example",
]);

let attempts = 0;
globalThis.fetch = async (_url, init) => {
  attempts += 1;
  if (attempts === 1) return new Response("blocked", { status: 403 });
  const request = JSON.parse(init.body);
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: request.method === "getBalance" ? { value: 99 } : { value: [] },
  });
};
const failoverResponse = await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19" }),
  }),
});
const failoverBody = await failoverResponse.json();
assert.equal(failoverResponse.status, 200);
assert.equal(failoverBody.lamports, 99);
assert.equal(attempts, 4);

let tokenCalls = 0;
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  if (request.method === "getBalance") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: { value: 123 } });
  }
  tokenCalls += 1;
  return new Response("rate limited", { status: 429 });
};
const incompleteResponse = await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    body: JSON.stringify({ address: "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19" }),
  }),
});
const incompleteBody = await incompleteResponse.json();
assert.equal(incompleteResponse.status, 200);
assert.equal(incompleteBody.tokenDataComplete, false);
assert.deepEqual(incompleteBody.tokens, []);
assert.equal(tokenCalls, 4);

const invalid = await portfolio.onRequestPost({
  request: new Request("https://signal.example/api/solana/portfolio", {
    method: "POST",
    body: JSON.stringify({ address: "not-a-wallet" }),
  }),
});
assert.equal(invalid.status, 400);

const wrongMethod = portfolio.onRequest();
assert.equal(wrongMethod.status, 405);

console.log("Cloudflare portfolio function regression test passed");
