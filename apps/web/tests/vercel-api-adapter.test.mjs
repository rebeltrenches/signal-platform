import assert from "node:assert/strict";
import handler from "../server/vercel-worker.mjs";
import rpc from "../api/solana/rpc.mjs";
import catchall from "../api/[...path].mjs";

let checks = 0;
async function call(url, { method = "GET", headers = {}, body, route = handler } = {}) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(value) { this.body = JSON.parse(String(value)); } };
  await route({ url, method, headers, body }, res);
  return res;
}
function check(value, expected) { assert.equal(value, expected); checks++; }
let r = await call("/api/geo", { headers: { "x-vercel-ip-country": "GB", "cf-ipcountry": "CN" }, route: catchall });
check(r.statusCode, 200);
check(r.body.level, "regulated");
check(r.body.country, "GB");
check(r.headers["cache-control"], "no-store, max-age=0");
r = await call("/api/geo", { headers: { "x-vercel-ip-country": "UA", "x-vercel-ip-country-region": "43" } });
check(r.body.level, "blocked");

let calls = 0;
globalThis.fetch = async () => { calls++; return Response.json({ jsonrpc: "2.0", result: 12 }); };
const send = { jsonrpc: "2.0", method: "sendTransaction", params: ["AAAA", { encoding: "base64" }] };
for (const [headers, expected, code] of [
  [{ "x-vercel-ip-country": "IR" }, 451, "REGION_BLOCKED"],
  [{ "cf-ipcountry": "DE" }, 503, "REGION_UNAVAILABLE"],
  [{ "x-vercel-ip-country": "DE" }, 400, "INVALID_SIGNED_TRANSACTION"],
]) {
  r = await call("/api/solana/rpc", { method: "POST", headers, body: send, route: rpc });
  check(r.statusCode, expected);
  check(r.body.code, code);
}
check(calls, 0);
for (const method of ["getBalance", "getMinimumBalanceForRentExemption"]) {
  r = await call("/api/solana/rpc", { method: "POST", body: { jsonrpc: "2.0", method, params: [] } });
  check(r.statusCode, 200);
  check(r.body.result, 12);
}

globalThis.fetch = async () => Response.json({
  format: "signal-ofac-sdn-addresses/1", generatedAt: new Date().toISOString(),
  count: 100, addresses: Array.from({ length: 100 }, (_, i) => "Filler" + String(i).padStart(26, "x")),
});
r = await call("/api/screening-status");
check(r.statusCode, 200);
check(r.body.list.ok, true);
r = await call("/api/wallet-screen", { method: "POST", headers: { "x-vercel-ip-country": "DE", "x-real-ip": "203.0.113.1" }, body: { address: "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg" } });
check(r.body.status, "clear");
check((await call("/api/unknown")).statusCode, 404);
check((await call("/api/solana/swap/build")).statusCode, 405);
check((await call("/api/solana/rpc", { method: "POST", body: "x".repeat(32_001) })).statusCode, 413);
console.log(`Vercel API adapter: ${checks} checks passed.`);
