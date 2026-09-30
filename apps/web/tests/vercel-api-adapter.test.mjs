import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import handler, { worker, resolveWorker } from "../server/vercel-worker.mjs";
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
// HTTP/2 requests carry pseudo-headers in req.headers; Fetch's Headers
// rejects those names. They're skipped, so /api/geo still answers.
r = await call("/api/geo", { headers: { ":authority": "signal.vercel.app", ":method": "GET", ":path": "/api/geo", ":scheme": "https", "x-vercel-ip-country": "ZA", "x-vercel-ip-country-region": "GP" } });
check(r.statusCode, 200);
check(r.body.level, "regulated");
check(r.body.country, "ZA");

// A request the adapter can't handle is logged with its cause (never
// header values) instead of disappearing behind API_ADAPTER_ERROR.
const logged = [];
const realError = console.error;
console.error = (...args) => logged.push(args.map(String).join(" "));
try {
  r = await call("/api/geo?x=1", { headers: { "x-bad-value": "secret-–-value" } });
} finally {
  console.error = realError;
}
check(r.statusCode, 500);
check(r.body.code, "API_ADAPTER_ERROR");
check(logged.length, 1);
check(/\[vercel-api\] request failed GET \/api\/geo TypeError/.test(logged[0]), true);
check(logged[0].includes("secret"), false);

// /token/<mint> is served by the one generated token page, as the
// Cloudflare Worker does; the visible URL (mint and query) is unchanged.
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const tokenRules = (vercel.rewrites || []).filter((rule) => rule.source.startsWith("/token/"));
check(tokenRules.length, 2);
const asRegExp = (source) => new RegExp("^" + source.replace(/:mint\(/, "(") + "$");
const served = (path) => tokenRules.some((rule) => asRegExp(rule.source).test(path));
const MINT = "3mwznTzZ5LJic9nvBCMLkXgw7scA6HnX1GNuQwmUf4Ar";
check(served(`/token/${MINT}`), true);
check(served(`/token/${MINT}/`), true);
check(served("/token/example"), false);
check(served("/token/example/"), false);
check(served(`/token/${MINT}/extra`), false);
for (const rule of tokenRules) {
  check(rule.destination, "/token/example/index.html");
  check(rule.destination.includes("?"), false); // Vercel passes the original query through
}
const buildScript = await readFile(new URL("../scripts/build.tsx", import.meta.url), "utf8");
check(buildScript.includes("path: 'token/example'"), true);

// The adapter must end up with a callable worker.fetch, whatever module
// shape the import gives it.
check(typeof worker?.fetch, "function");
check(resolveWorker({}), null);
check(resolveWorker(null), null);
// Vercel can bundle worker.js as CommonJS (its package.json has no
// "type": "module"); the default import then arrives as { default: { fetch } }.
// Reproduce that shape with esbuild and check the adapter still finds fetch.
const cjsDir = await mkdtemp(join(tmpdir(), "signal-vercel-cjs-"));
try {
  const cjsFile = join(cjsDir, "worker.cjs");
  await build({ entryPoints: [fileURLToPath(new URL("../../../worker.js", import.meta.url))], bundle: true, platform: "node", format: "cjs", outfile: cjsFile, logLevel: "silent" });
  const cjsNamespace = await import(pathToFileURL(cjsFile).href);
  check(typeof cjsNamespace.default.fetch, "undefined"); // the shape that broke `worker.fetch` on Vercel
  check(typeof resolveWorker(cjsNamespace)?.fetch, "function");
  check(typeof resolveWorker(cjsNamespace.default)?.fetch, "function");
} finally {
  await rm(cjsDir, { recursive: true, force: true });
}

console.log(`Vercel API adapter: ${checks} checks passed.`);
