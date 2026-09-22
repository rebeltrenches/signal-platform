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
});
const body = await response.json();

assert.equal(response.status, 200);
assert.equal(body.lamports, 5_127_142);
assert.deepEqual(methods, ["getBalance", "getTokenAccountsByOwner", "getTokenAccountsByOwner"]);

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
