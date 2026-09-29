// Regional restrictions and sanctions screening on the Worker:
// config/restrictions.json, functions/compliance.js, /api/geo,
// /api/wallet-screen, the launch-registration proxy and the swap gates.
// The OFAC SDN list download (Treasury) and the Signal API are mocked;
// nothing leaves the machine.
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
const SANCTIONED_EVM = "0x8576aCC5C05D6Ce88f4e49bf65BdF0C62F91353C"; // listed in lower case below
const API = "https://signal-api.test";
const env = { SIGNAL_EDGE_SECRET: "edge-secret-123", SIGNAL_API_ORIGIN: API };

/** An SDN.XML in the real layout: the sanctioned test addresses, other ID
 *  types that must be ignored, and filler entries so it passes the
 *  "looks like the real list" size check. */
function sdnXml({ entries = 150, extra = "" } = {}) {
  const id = (type, number) => `<id><uid>1</uid><idType>${type}</idType><idNumber>${number}</idNumber></id>`;
  const filler = Array.from({ length: entries }, (_, i) => id("Digital Currency Address - XBT", `1Filler${String(i).padStart(26, "x")}`)).join("\n");
  return `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns="https://tempuri.org/sdnList.xsd">
  <publshInformation><Publish_Date>09/23/2026</Publish_Date><Record_Count>1</Record_Count></publshInformation>
  <sdnEntry><lastName>TEST ENTITY</lastName><idList>
    ${id("Passport", "A1234567")}
    ${id("Digital Currency Address - SOL", SANCTIONED)}
    ${id("Digital Currency Address - ETH", SANCTIONED_EVM.toLowerCase())}
    ${id("Digital Currency Address - USDT", "TA3941uFAvmVibSkQ6fMJXxmaSNovX86mz")}
  </idList></sdnEntry>
  ${filler}
  ${extra}
</sdnList>`;
}

/** Mocks Treasury's SDN download and the Signal API; records every call.
 *  `sdn` answers the list download; `chunk` streams it in small pieces. */
function network({ sdn = () => sdnXml(), chunk = 0, session = () => Response.json({ address: WALLET }), register = () => Response.json({ ok: true }, { status: 201 }) } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    calls.push({ url: u, method: init.method || "GET", headers, body: init.body });
    if (u === compliance.SDN_XML_URL) {
      const answer = sdn();
      if (answer instanceof Response) return answer;
      if (!chunk) return new Response(answer, { headers: { "content-type": "text/xml" } });
      const bytes = new TextEncoder().encode(answer);
      return new Response(new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.subarray(i, i + chunk));
          controller.close();
        },
      }));
    }
    if (u === `${API}/api/v1/auth/session`) return session(headers);
    if (u === `${API}/api/v1/tokens/register`) return register(headers, init.body);
    return new Response("unexpected", { status: 500 });
  };
  return calls;
}
const sdnDownloads = (calls) => calls.filter((c) => c.url === compliance.SDN_XML_URL).length;

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

await test("config: Level 2 is GB, US, ZA, each with its own warning; a terms version is set; screening is OFAC, keyless", () => {
  const regulated = config.levels.regulated.countries;
  assert.deepEqual(Object.keys(regulated).sort(), ["GB", "US", "ZA"]);
  assert.match(regulated.GB.warning, /financial promotion/);
  assert.match(regulated.US.warning, /securities|money transmission/);
  assert.match(regulated.ZA.warning, /FSCA/);
  assert.match(config.termsVersion, /^\d{4}-\d{2}-\d{2}/);
  assert.ok(config.notes.some((note) => /OFAC SDN/.test(note) && /No key/.test(note)));
  assert.ok(!JSON.stringify(config).includes("CHAINALYSIS"));
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

// ---- the OFAC SDN list -----------------------------------------------------------------------
await test("SDN parser: keeps only digital currency addresses, normalizes EVM case, reads the publish date", async () => {
  const parsed = await compliance.parseSdnXml(new Response(sdnXml()).body);
  assert.equal(parsed.publishDate, "09/23/2026");
  assert.ok(parsed.addresses.has(SANCTIONED));
  assert.ok(parsed.addresses.has(SANCTIONED_EVM.toLowerCase()));
  assert.ok(!parsed.addresses.has("A1234567"), "passport numbers are not addresses");
  assert.equal(parsed.currencies.SOL, 1);
  assert.equal(parsed.addresses.size, 3 + 150);
});

await test("SDN parser: entries split across tiny stream chunks are all found", async () => {
  for (const size of [1, 7, 33, 4096]) {
    const bytes = new TextEncoder().encode(sdnXml());
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.subarray(i, i + size)); c.close(); } });
    const parsed = await compliance.parseSdnXml(stream);
    assert.equal(parsed.addresses.size, 153, `chunk size ${size}`);
    assert.ok(parsed.addresses.has(SANCTIONED));
  }
});

await test("screening: listed Solana and EVM wallets (any letter case) are sanctioned; others are clear; no key needed", async () => {
  const calls = network({ chunk: 512 });
  assert.equal((await compliance.screenWallet(SANCTIONED, {})).status, "sanctioned");
  const evm = await compliance.screenWallet(SANCTIONED_EVM, {});
  assert.equal(evm.status, "sanctioned");
  assert.deepEqual(evm.names, ["OFAC SDN list (published 09/23/2026)"]);
  assert.deepEqual(await compliance.screenWallet(WALLET, {}), { status: "clear" });
  assert.deepEqual(await compliance.screenWallet("0x0000000000000000000000000000000000000001", {}), { status: "clear" });
  assert.equal(sdnDownloads(calls), 1, "one download serves every check");
  assert.equal(calls[0].headers["x-api-key"], undefined, "no key is sent anywhere");
});

await test("the list is cached and refreshed after its TTL (at least twice a day); concurrent checks share one download", async () => {
  const calls = network();
  const t0 = 1_000_000;
  await Promise.all(Array.from({ length: 10 }, () => compliance.screenWallet(WALLET, env, t0)));
  assert.equal(sdnDownloads(calls), 1, "shared");
  await compliance.screenWallet(WALLET, env, t0 + compliance.SDN_LIST_TTL_MS - 1);
  assert.equal(sdnDownloads(calls), 1, "cached");
  await compliance.screenWallet(WALLET, env, t0 + compliance.SDN_LIST_TTL_MS + 1);
  assert.equal(sdnDownloads(calls), 2, "refreshed");
  assert.ok(compliance.SDN_LIST_TTL_MS <= 24 * 60 * 60_000);
});

await test("fail safe: with no list (download fails, times out, or isn't really the list) screening is 'unavailable'", async () => {
  for (const sdn of [
    () => new Response("down", { status: 503 }),
    () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
    () => "<html>Service temporarily unavailable</html>",
    () => sdnXml({ entries: 10 }), // far fewer addresses than the real list: not trusted
  ]) {
    compliance.resetComplianceForTests();
    network({ sdn });
    const result = await compliance.screenWallet(WALLET, env);
    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /OFAC sanctions list couldn't be loaded/);
  }
  assert.equal((await compliance.screenWallet("not-an-address", env)).status, "unavailable");
});

await test("a failed refresh keeps using the list for up to 48 hours, then fails safe; a later refresh recovers", async () => {
  network();
  const t0 = 5_000_000;
  await compliance.screenWallet(WALLET, env, t0);
  network({ sdn: () => new Response("down", { status: 503 }) });
  assert.equal((await compliance.screenWallet(SANCTIONED, env, t0 + compliance.SDN_LIST_TTL_MS + 1)).status, "sanctioned", "stale but usable");
  assert.equal((await compliance.screenWallet(WALLET, env, t0 + compliance.SDN_MAX_STALE_MS - 1)).status, "clear");
  assert.equal((await compliance.screenWallet(WALLET, env, t0 + compliance.SDN_MAX_STALE_MS + 1)).status, "unavailable", "too old");
  network();
  assert.equal((await compliance.screenWallet(WALLET, env, t0 + compliance.SDN_MAX_STALE_MS + 2)).status, "clear", "recovered");
});

await test("POST /api/wallet-screen: clear / sanctioned / unavailable, EVM too, 451 in blocked regions, 400 bad input, rate limit", async () => {
  network();
  const post = (address, opts = {}) => screenRoute.onRequestPost({ request: req("/api/wallet-screen", { method: "POST", body: { address }, country: "DE", ...opts }), env, now: opts.now });
  assert.deepEqual(await (await post(WALLET)).json(), { status: "clear" });
  assert.equal((await (await post(SANCTIONED)).json()).status, "sanctioned");
  assert.equal((await (await post(SANCTIONED_EVM)).json()).status, "sanctioned", "Base/BNB wallets are screened too");
  assert.deepEqual(await (await post("0xabc1230000000000000000000000000000de0d00")).json(), { status: "clear" });
  assert.equal((await post("0xabc123")).status, 400);
  assert.equal((await post(WALLET, { country: "KP" })).status, 451);
  assert.equal((await post("nope")).status, 400);
  compliance.resetComplianceForTests();
  network({ sdn: () => new Response("down", { status: 500 }) });
  const unavailable = await (await post(WALLET)).json();
  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.message, /paused until the check succeeds/);
  screenRoute.resetWalletScreenForTests();
  compliance.resetComplianceForTests();
  network();
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
    const calls = network();
    const response = await registration({ country, region });
    assert.equal(response.status, 451, country);
    assert.equal((await response.json()).code, "REGION_BLOCKED");
    assert.deepEqual(calls, [], "no API or list calls");
  }
});

await test("the wallet screened is the session's own wallet, read from the API — never from the request", async () => {
  const calls = network({ session: () => Response.json({ address: SANCTIONED }) });
  const response = await registration({ body: { chain: "solana", address: "x", name: "T", symbol: "T", decimals: 6, creator: WALLET } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "WALLET_SANCTIONED");
  assert.ok(calls.some((c) => c.url === `${API}/api/v1/auth/session`), "the session wallet was looked up");
  assert.ok(!calls.some((c) => c.url.endsWith("/api/v1/tokens/register")), "nothing forwarded");
});

await test("screening unavailable (no OFAC list): registration fails safe (503, try again), nothing forwarded", async () => {
  const calls = network({ sdn: () => new Response("down", { status: 502 }) });
  const response = await registration();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "SCREENING_UNAVAILABLE");
  assert.match(body.error, /try again/);
  assert.ok(!calls.some((c) => c.url.endsWith("/api/v1/tokens/register")));
});

await test("a cleared wallet is forwarded with the edge secret, the screened wallet and the country", async () => {
  const calls = network();
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
  network();
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
await test("swap building: blocked regions 451, sanctioned taker 403, no OFAC list 503 — before any quote work", async () => {
  const build = (taker, country = "DE") => swapBuild.onRequestPost({
    request: req("/api/solana/swap/build", { method: "POST", country, body: { tokenMint: "So11111111111111111111111111111111111111112", taker, amount: "1000" } }),
    env,
  });
  network();
  assert.equal((await build(WALLET, "CU")).status, 451);
  assert.equal((await build(SANCTIONED)).status, 403);
  compliance.resetComplianceForTests();
  network({ sdn: () => new Response("down", { status: 500 }) });
  assert.equal((await build(WALLET)).status, 503);
  compliance.resetComplianceForTests();
  network();
  const cleared = await build(WALLET);
  assert.ok(![451, 403, 503].includes(cleared.status), "a cleared wallet reaches the normal swap validation");
});

await test("swap submission from a blocked region is refused (451)", async () => {
  network();
  const response = await swapSubmit.onRequestPost({ request: req("/api/solana/swap/submit", { method: "POST", country: "IR", body: {} }), env });
  assert.equal(response.status, 451);
});

console.log(`\n${passed} passed.`);

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
