// Regional restrictions and sanctions screening on the Worker:
// config/restrictions.json, functions/compliance.js, /api/geo,
// /api/wallet-screen, the launch-registration proxy and the swap gates.
// Chainalysis and the Signal API are mocked; nothing leaves the machine.
//
// Run with: node apps/web/tests/compliance-functions.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The functions are ES modules in a CommonJS repo root: load them from a
// copy that keeps their relative layout (functions/ + config/).
const root = await mkdtemp(join(tmpdir(), "compliance-"));
await cp("functions", join(root, "functions"), { recursive: true });
await cp("config", join(root, "config"), { recursive: true });
await writeFile(join(root, "package.json"), '{ "type": "module" }');
const load = (path) => import(pathToFileURL(join(root, path)).href);
const compliance = await load("functions/compliance.js");
const geoRoute = await load("functions/api/geo.js");
const screenRoute = await load("functions/api/wallet-screen.js");
const registerRoute = await load("functions/api/register-token.js");
const swapBuild = await load("functions/api/solana/swap-build.js");
const swapSubmit = await load("functions/api/solana/swap-submit.js");
const config = JSON.parse(await readFile("config/restrictions.json", "utf8"));

let passed = 0;
async function test(name, fn) {
  compliance.resetComplianceForTests();
  screenRoute.resetWalletScreenForTests();
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const WALLET = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg";
const SANCTIONED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const API = "https://signal-api.test";
const KEY = "test-chainalysis-key";
const env = { CHAINALYSIS_API_KEY: KEY, SIGNAL_EDGE_SECRET: "edge-secret-123", SIGNAL_API_ORIGIN: API };

/** A request as the Worker sees it: request.cf carries Cloudflare's location. */
function req(url, { country, region, method = "GET", body, headers = {} } = {}) {
  const request = new Request(`https://signal.test${url}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5", ...headers },
    ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  Object.defineProperty(request, "cf", { value: { country, regionCode: region } });
  return request;
}

/** Mocks Chainalysis and the Signal API; records every call. */
function network({ chainalysis = () => Response.json({ identifications: [] }), session = () => Response.json({ address: WALLET }), register = () => Response.json({ ok: true }, { status: 201 }) } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    calls.push({ url: u, method: init.method || "GET", headers, body: init.body });
    if (u.startsWith("https://public.chainalysis.com/api/v1/address/")) return chainalysis(decodeURIComponent(u.split("/").pop()), headers);
    if (u === `${API}/api/v1/auth/session`) return session(headers);
    if (u === `${API}/api/v1/tokens/register`) return register(headers, init.body);
    return new Response("unexpected", { status: 500 });
  };
  return calls;
}
const sanctionsAnswer = (address) => Response.json({
  identifications: address === SANCTIONED ? [{ category: "sanctions", name: "SANCTIONS: OFAC SDN Test", description: "test", url: "https://example.test" }] : [],
});

console.log("compliance-functions.test.mjs\n");

// ---- the config ---------------------------------------------------------------------
await test("config: Level 1 is exactly CN, IR, KP, CU (+ occupied regions); CN is mainland only", () => {
  assert.deepEqual(Object.keys(config.levels.blocked.countries).sort(), ["CN", "CU", "IR", "KP"]);
  for (const code of ["HK", "MO", "TW"]) {
    assert.ok(!(code in config.levels.blocked.countries) && !(code in config.levels.regulated.countries), `${code} is not restricted`);
  }
  assert.match(config.levels.blocked.countries.CN.note, /Hong Kong.*Macau.*Taiwan/);
  assert.deepEqual(Object.keys(config.levels.blocked.regions).filter((k) => k !== "$comment").sort(), ["UA-09", "UA-14", "UA-40", "UA-43"]);
  assert.match(config.levels.blocked.regions.$comment, /LIMITATION/);
});

await test("config: Syria is not blocked, with a note that its 2026 sanctions change must be followed", () => {
  assert.ok(!("SY" in config.levels.blocked.countries) && !("SY" in config.levels.regulated.countries));
  assert.ok(config.notes.some((note) => /Syria/.test(note) && /2026/.test(note) && /current sanctions framework/.test(note)));
});

await test("config: Level 2 is GB, US, ZA, each with its own warning; a terms version is set", () => {
  const regulated = config.levels.regulated.countries;
  assert.deepEqual(Object.keys(regulated).sort(), ["GB", "US", "ZA"]);
  assert.match(regulated.GB.warning, /financial promotion/);
  assert.match(regulated.US.warning, /securities|money transmission/);
  assert.match(regulated.ZA.warning, /FSCA/);
  assert.match(config.termsVersion, /^\d{4}-\d{2}-\d{2}/);
});

// ---- location and level ----------------------------------------------------------------
await test("levels come from Cloudflare's country: blocked, regulated, allowed; HK/MO/TW allowed", () => {
  const level = (country, region) => compliance.geoForRequest(req("/", { country, region })).level;
  for (const c of ["CN", "IR", "KP", "CU"]) assert.equal(level(c), "blocked", c);
  for (const c of ["GB", "US", "ZA"]) assert.equal(level(c), "regulated", c);
  for (const c of ["HK", "MO", "TW", "SY", "DE", "RU", "UA"]) assert.equal(level(c), "allowed", c);
});

await test("occupied regions are blocked by Cloudflare's region code; the rest of Ukraine isn't", () => {
  const level = (region) => compliance.geoForRequest(req("/", { country: "UA", region })).level;
  for (const region of ["43", "40", "14", "09"]) assert.equal(level(region), "blocked", region);
  assert.equal(level("30"), "allowed", "Kyiv");
  assert.equal(level(undefined), "allowed", "no region data");
});

await test("the CF-IPCountry header is used when request.cf is absent; XX and Tor (T1) are 'unknown', not blocked", () => {
  const plain = new Request("https://signal.test/", { headers: { "cf-ipcountry": "ir" } });
  assert.equal(compliance.geoForRequest(plain).level, "blocked");
  for (const code of ["XX", "T1"]) {
    const g = compliance.geoForRequest(req("/", { country: code }));
    assert.equal(g.country, null);
    assert.equal(g.level, "allowed");
  }
});

await test("levels are config-driven: moving ZA from Level 2 to Level 1 needs no code", () => {
  const moved = structuredClone(config);
  moved.levels.blocked.countries.ZA = moved.levels.regulated.countries.ZA;
  delete moved.levels.regulated.countries.ZA;
  assert.equal(compliance.levelFor({ country: "ZA", region: null }, moved).level, "blocked");
  assert.equal(compliance.levelFor({ country: "ZA", region: null }, config).level, "regulated");
});

await test("GET /api/geo: country, level, the region's name/notice or warning, and the terms version; never cached", async () => {
  const blocked = await (await geoRoute.onRequestGet({ request: req("/api/geo", { country: "CN" }) })).json();
  assert.deepEqual(blocked, { country: "CN", region: null, level: "blocked", name: "Mainland China", notice: config.levels.blocked.notice, termsVersion: config.termsVersion });
  const response = await geoRoute.onRequestGet({ request: req("/api/geo", { country: "GB" }) });
  const regulated = await response.json();
  assert.equal(regulated.level, "regulated");
  assert.equal(regulated.warning, config.levels.regulated.countries.GB.warning);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

// ---- sanctions screening -------------------------------------------------------------------
await test("screening: clear and sanctioned wallets, via Chainalysis with the API key header", async () => {
  const calls = network({ chainalysis: sanctionsAnswer });
  assert.deepEqual(await compliance.screenWallet(WALLET, env), { status: "clear" });
  const hit = await compliance.screenWallet(SANCTIONED, env);
  assert.equal(hit.status, "sanctioned");
  assert.deepEqual(hit.names, ["SANCTIONS: OFAC SDN Test"]);
  assert.equal(calls[0].headers["x-api-key"], KEY);
});

await test("screening fails safe: no key, HTTP errors, odd answers, timeouts and network errors are 'unavailable'", async () => {
  network();
  assert.equal((await compliance.screenWallet(WALLET, {})).status, "unavailable");
  for (const chainalysis of [
    () => new Response("forbidden", { status: 403 }),
    () => new Response("slow down", { status: 429 }),
    () => Response.json({ unexpected: true }),
    () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
    () => { throw new TypeError("network"); },
  ]) {
    compliance.resetComplianceForTests();
    network({ chainalysis });
    assert.equal((await compliance.screenWallet(WALLET, env)).status, "unavailable");
  }
  assert.equal((await compliance.screenWallet("not-an-address", env)).status, "unavailable");
});

await test("screening caches answers briefly; failures are not cached, so a retry really retries", async () => {
  let calls = network({ chainalysis: sanctionsAnswer });
  await compliance.screenWallet(WALLET, env, 1_000);
  await compliance.screenWallet(WALLET, env, 1_000 + compliance.SCREENING_CACHE_MS.clear - 1);
  assert.equal(calls.length, 1, "cached");
  await compliance.screenWallet(WALLET, env, 1_000 + compliance.SCREENING_CACHE_MS.clear + 1);
  assert.equal(calls.length, 2, "expired");
  compliance.resetComplianceForTests();
  calls = network({ chainalysis: () => new Response("down", { status: 503 }) });
  await compliance.screenWallet(WALLET, env);
  await compliance.screenWallet(WALLET, env);
  assert.equal(calls.length, 2, "failures retried");
});

await test("POST /api/wallet-screen: clear / sanctioned / unavailable, 451 in blocked regions, 400 bad input, rate limit", async () => {
  network({ chainalysis: sanctionsAnswer });
  const post = (address, opts = {}) => screenRoute.onRequestPost({ request: req("/api/wallet-screen", { method: "POST", body: { address }, country: "DE", ...opts }), env, now: opts.now });
  assert.deepEqual(await (await post(WALLET)).json(), { status: "clear" });
  assert.equal((await (await post(SANCTIONED)).json()).status, "sanctioned");
  assert.equal((await post(WALLET, { country: "KP" })).status, 451);
  assert.equal((await post("nope")).status, 400);
  // Base/BNB wallets connected on the Create page are screened too.
  assert.deepEqual(await (await post("0xabc1230000000000000000000000000000de0d00")).json(), { status: "clear" });
  assert.equal((await post("0xabc123")).status, 400);
  compliance.resetComplianceForTests();
  network({ chainalysis: () => new Response("down", { status: 500 }) });
  const unavailable = await (await post(WALLET)).json();
  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.message, /paused until the check succeeds/);
  screenRoute.resetWalletScreenForTests();
  network({ chainalysis: sanctionsAnswer });
  for (let i = 0; i < screenRoute.SCREEN_RATE_LIMIT.requests; i += 1) await post(WALLET, { now: 5_000 });
  const limited = await post(WALLET, { now: 5_001 });
  assert.equal(limited.status, 429);
});

// ---- launch registration through the Worker ------------------------------------------------
const registration = (opts = {}) => registerRoute.onRequestPost({
  request: req("/api/v1/tokens/register", {
    method: "POST",
    country: "DE",
    headers: { authorization: "Bearer session-token" },
    body: { chain: "solana", address: "Mint1111111111111111111111111111111111111111", name: "T", symbol: "T", decimals: 6 },
    ...opts,
  }),
  env: opts.env ?? env,
});

await test("registration from a blocked region is refused (451) before anything reaches the API", async () => {
  for (const [country, region] of [["CN"], ["IR"], ["UA", "43"]]) {
    const calls = network({ chainalysis: sanctionsAnswer });
    const response = await registration({ country, region });
    assert.equal(response.status, 451, country);
    assert.equal((await response.json()).code, "REGION_BLOCKED");
    assert.deepEqual(calls, [], "no API or screening calls");
  }
});

await test("the wallet screened is the session's own wallet, read from the API — never from the request", async () => {
  const calls = network({ chainalysis: sanctionsAnswer, session: () => Response.json({ address: SANCTIONED }) });
  const response = await registration({ body: { chain: "solana", address: "x", name: "T", symbol: "T", decimals: 6, creator: WALLET } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "WALLET_SANCTIONED");
  assert.ok(calls.some((c) => c.url.endsWith(encodeURIComponent(SANCTIONED))), "the session wallet was screened");
  assert.ok(!calls.some((c) => c.url.endsWith("/api/v1/tokens/register")), "nothing forwarded");
});

await test("screening unavailable: registration fails safe (503, try again), nothing forwarded", async () => {
  const calls = network({ chainalysis: () => new Response("down", { status: 502 }) });
  const response = await registration();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "SCREENING_UNAVAILABLE");
  assert.match(body.error, /try again/);
  assert.ok(!calls.some((c) => c.url.endsWith("/api/v1/tokens/register")));
});

await test("a cleared wallet is forwarded with the edge secret, the screened wallet and the country", async () => {
  const calls = network({ chainalysis: sanctionsAnswer });
  const response = await registration({ country: "US" });
  assert.equal(response.status, 201);
  const forwarded = calls.find((c) => c.url === `${API}/api/v1/tokens/register`);
  assert.equal(forwarded.headers["x-signal-edge-secret"], env.SIGNAL_EDGE_SECRET);
  assert.equal(forwarded.headers["x-signal-screened-wallet"], WALLET);
  assert.equal(forwarded.headers["x-signal-country"], "US");
  assert.equal(forwarded.headers.authorization, "Bearer session-token");
  assert.equal(JSON.parse(forwarded.body).address, "Mint1111111111111111111111111111111111111111");
});

await test("registration fails safe without configuration, needs a sign-in, and passes an expired session back as 401", async () => {
  network({ chainalysis: sanctionsAnswer });
  for (const missing of ["SIGNAL_EDGE_SECRET", "SIGNAL_API_ORIGIN"]) {
    const partial = { ...env };
    delete partial[missing];
    const response = await registration({ env: partial });
    assert.equal(response.status, 503, missing);
    assert.equal((await response.json()).code, "REGISTRATION_NOT_CONFIGURED");
  }
  assert.equal((await registration({ headers: {} })).status, 401);
  network({ session: () => new Response("{}", { status: 401 }) });
  assert.equal((await registration()).status, 401);
});

// ---- trading ---------------------------------------------------------------------------------
await test("swap building: blocked regions 451, sanctioned taker 403, screening down 503 — before any quote work", async () => {
  const build = (taker, country = "DE") => swapBuild.onRequestPost({
    request: req("/api/solana/swap/build", { method: "POST", country, body: { tokenMint: "So11111111111111111111111111111111111111112", taker, amount: "1000" } }),
    env,
  });
  network({ chainalysis: sanctionsAnswer });
  assert.equal((await build(WALLET, "CU")).status, 451);
  assert.equal((await build(SANCTIONED)).status, 403);
  compliance.resetComplianceForTests();
  network({ chainalysis: () => new Response("down", { status: 500 }) });
  assert.equal((await build(WALLET)).status, 503);
  compliance.resetComplianceForTests();
  network({ chainalysis: sanctionsAnswer });
  const cleared = await build(WALLET);
  assert.ok(![451, 403, 503].includes(cleared.status), "a cleared wallet reaches the normal swap validation");
});

await test("swap submission from a blocked region is refused (451)", async () => {
  network();
  const response = await swapSubmit.onRequestPost({ request: req("/api/solana/swap/submit", { method: "POST", country: "IR", body: {} }), env });
  assert.equal(response.status, 451);
});

console.log(`\n${passed} passed.`);
