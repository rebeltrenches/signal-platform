// turbo-upload.js against a fake ArDrive Turbo (no network): free
// uploads, the automatic fallback to a paid upload when Turbo refuses a
// free one (HTTP 402), the creator's approval of the shown cost, and
// never paying twice.
//
// Run with: node apps/web/tests/turbo-upload.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const esm = await mkdtemp(join(tmpdir(), "turbo-upload-"));
for (const file of ["turbo-upload.js", "ans104.js"]) await cp(`apps/web/src/client/${file}`, join(esm, file));
await writeFile(join(esm, "package.json"), '{ "type": "module" }');
const turboModule = await import(pathToFileURL(join(esm, "turbo-upload.js")).href);
const { createTurboClient, uploadDataItems, lamportsForWinc, StoragePaymentDeclined, TURBO_SOLANA_DEPOSIT_ADDRESS } = turboModule;

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const OWNER = "CreatorWa11et111111111111111111111111111111";
const WINC_PER_BYTE = 1000n;
const WINC_PER_LAMPORT = 10n;

// A data item as the uploader sees it: its id is SHA-256 of the signature.
function item(label, size) {
  const bytes = crypto.randomBytes(size);
  bytes.writeUInt16LE(4, 0);
  return { label, bytes: new Uint8Array(bytes), id: crypto.createHash("sha256").update(bytes.subarray(2, 66)).digest("base64url") };
}

/** Fake Turbo. `free(bytes)` says whether a free upload is accepted. */
function fakeTurbo({ free = () => true, balance = null, depositAddress = TURBO_SOLANA_DEPOSIT_ADDRESS, creditDelayPolls = 0, uploadStatus = null, returnWrongId = false } = {}) {
  const state = { balance, stored: [], paidSignatures: new Set(), credited: new Set(), submitted: [], pollsUntilCredit: creditDelayPolls, calls: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  state.fetch = async (url, init = {}) => {
    const u = new URL(url);
    state.calls.push(`${init.method || "GET"} ${u.pathname}`);
    if (u.host === "upload.ardrive.io" && u.pathname === "/v1/tx/solana") {
      if (uploadStatus) return new Response("boom", { status: uploadStatus });
      const bytes = new Uint8Array(init.body);
      const id = crypto.createHash("sha256").update(bytes.subarray(2, 66)).digest("base64url");
      const price = BigInt(bytes.length) * WINC_PER_BYTE;
      if (free(bytes)) {
        state.stored.push(id);
        return json(200, { id: returnWrongId ? "wrong" : id });
      }
      if ((state.balance ?? 0n) >= price) {
        state.balance -= price;
        state.stored.push(id);
        return json(200, { id });
      }
      return new Response("Insufficient balance", { status: 402 });
    }
    if (u.pathname === "/v1/account/balance/solana" && (init.method || "GET") === "GET") {
      assert.equal(u.searchParams.get("address"), OWNER);
      // Credit arrives only after the configured number of balance polls.
      for (const signature of state.paidSignatures) {
        if (state.submitted.includes(signature) && !state.credited.has(signature)) {
          if (state.pollsUntilCredit > 0) {
            state.pollsUntilCredit -= 1;
          } else {
            state.credited.add(signature);
            state.balance = (state.balance ?? 0n) + state.paidLamports.get(signature) * WINC_PER_LAMPORT;
          }
        }
      }
      return state.balance === null ? new Response("User Not Found", { status: 404 }) : json(200, { winc: state.balance.toString() });
    }
    if (u.pathname === "/v1/account/balance/solana" && init.method === "POST") {
      const { tx_id } = JSON.parse(init.body);
      if (!state.paidSignatures.has(tx_id)) return new Response("not found", { status: 404 });
      state.submitted.push(tx_id);
      return json(200, { status: "pending" });
    }
    const price = u.pathname.match(/^\/v1\/price\/bytes\/(\d+)$/);
    if (price) return json(200, { winc: (BigInt(price[1]) * WINC_PER_BYTE).toString() });
    const sol = u.pathname.match(/^\/v1\/price\/solana\/(\d+)$/);
    if (sol) return json(200, { winc: (BigInt(sol[1]) * WINC_PER_LAMPORT).toString() });
    if (u.pathname === "/v1/info") return json(200, { addresses: { solana: depositAddress } });
    return new Response("unexpected", { status: 500 });
  };
  state.paidLamports = new Map();
  return state;
}

function memoryStore() {
  const map = new Map();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) };
}

function run(fake, items, { approve = true, store = memoryStore() } = {}) {
  const log = { approvals: [], payments: [], statuses: [] };
  const promise = uploadDataItems({
    items,
    ownerAddress: OWNER,
    turbo: createTurboClient({ fetch: fake.fetch }),
    store,
    sleep: async () => {},
    onStatus: (text) => log.statuses.push(text),
    approvePayment: async (quote) => {
      log.approvals.push(quote);
      return approve;
    },
    pay: async ({ lamports, depositAddress }) => {
      const signature = `pay-sig-${log.payments.length + 1}`;
      log.payments.push({ lamports, depositAddress, signature });
      fake.paidSignatures.add(signature);
      fake.paidLamports.set(signature, lamports);
      return signature;
    },
  });
  return { promise, log, store };
}

const expectedLamports = (bytes) => {
  const winc = BigInt(bytes) * WINC_PER_BYTE;
  const exact = (winc + WINC_PER_LAMPORT - 1n) / WINC_PER_LAMPORT;
  return exact + (exact * 10n + 99n) / 100n;
};

console.log("turbo-upload.test.mjs\n");

await test("free uploads: both files stored, no price lookups, no approval, no payment", async () => {
  const fake = fakeTurbo();
  const items = [item("the logo", 5000), item("the metadata", 300)];
  const { promise, log } = run(fake, items);
  await promise;
  assert.deepEqual(fake.stored, items.map((i) => i.id));
  assert.equal(log.approvals.length, 0);
  assert.equal(log.payments.length, 0);
  assert.ok(fake.calls.every((call) => call === "POST /v1/tx/solana"));
});

await test("free refused (402): the cost is shown and approved first, then paid from the wallet and uploaded", async () => {
  const fake = fakeTurbo({ free: () => false });
  const items = [item("the logo", 5000), item("the metadata", 300)];
  const { promise, log, store } = run(fake, items);
  await promise;
  assert.equal(log.approvals.length, 1);
  assert.equal(log.approvals[0].lamports, expectedLamports(5300));
  assert.equal(log.approvals[0].reason, "Insufficient balance");
  assert.equal(log.approvals[0].depositAddress, TURBO_SOLANA_DEPOSIT_ADDRESS);
  assert.deepEqual(log.payments.map((p) => [p.lamports, p.depositAddress]), [[expectedLamports(5300), TURBO_SOLANA_DEPOSIT_ADDRESS]]);
  assert.deepEqual(fake.stored, items.map((i) => i.id));
  assert.ok(fake.submitted.includes("pay-sig-1"), "the payment is reported to Turbo");
  assert.equal(store.map.size, 0, "no pending payment remains once credited");
  // The approval came before the payment.
  assert.ok(log.statuses.indexOf("waiting for your approval") < log.statuses.indexOf("waiting for ArDrive Turbo to credit your payment"));
});

await test("declining the cost stops before anything is sent or stored", async () => {
  const fake = fakeTurbo({ free: () => false });
  const { promise, log } = run(fake, [item("the logo", 5000), item("the metadata", 300)], { approve: false });
  await assert.rejects(promise, StoragePaymentDeclined);
  assert.equal(log.payments.length, 0);
  assert.equal(fake.stored.length, 0);
});

await test("free for the logo but not the metadata: pays only for what's left", async () => {
  let uploads = 0;
  const fake = fakeTurbo({ free: () => ++uploads === 1 });
  const items = [item("the logo", 5000), item("the metadata", 300)];
  const { promise, log } = run(fake, items);
  await promise;
  assert.equal(log.payments.length, 1);
  assert.equal(log.payments[0].lamports, expectedLamports(300));
  assert.deepEqual(fake.stored, items.map((i) => i.id));
});

await test("an existing Turbo balance that covers the files is used without asking or paying", async () => {
  const fake = fakeTurbo({ free: () => false, balance: 10_000_000n });
  const { promise, log } = run(fake, [item("the logo", 5000), item("the metadata", 300)]);
  await promise;
  assert.equal(log.approvals.length, 0);
  assert.equal(log.payments.length, 0);
  assert.equal(fake.stored.length, 2);
});

await test("a partial balance: only the shortfall is charged", async () => {
  const fake = fakeTurbo({ free: () => false, balance: 3_000_000n });
  const { promise, log } = run(fake, [item("the logo", 5000), item("the metadata", 300)]);
  await promise;
  const shortfall = 5300n * WINC_PER_BYTE - 3_000_000n;
  const exact = (shortfall + WINC_PER_LAMPORT - 1n) / WINC_PER_LAMPORT;
  assert.equal(log.payments[0].lamports, exact + (exact * 10n + 99n) / 100n);
});

await test("payment sent but not credited: fails with the signature, and a retry applies it instead of paying again", async () => {
  const fake = fakeTurbo({ free: () => false, creditDelayPolls: 1000 });
  const items = [item("the logo", 5000), item("the metadata", 300)];
  const first = run(fake, items);
  await assert.rejects(first.promise, /pay-sig-1.*won't charge you again/);
  assert.equal(first.log.payments.length, 1);
  assert.equal(fake.stored.length, 0);
  assert.equal(first.store.get(`turbo_payment_${OWNER}`).signature, "pay-sig-1");

  fake.pollsUntilCredit = 0; // Turbo credits it now
  const retry = run(fake, items, { store: first.store });
  await retry.promise;
  assert.equal(retry.log.approvals.length, 0, "no new approval");
  assert.equal(retry.log.payments.length, 0, "no second payment");
  assert.deepEqual(fake.stored, items.map((i) => i.id));
  assert.equal(first.store.map.size, 0);
});

await test("if Turbo's deposit address differs from the expected one, no SOL is sent", async () => {
  const fake = fakeTurbo({ free: () => false, depositAddress: "Attacker111111111111111111111111111111111111" });
  const { promise, log } = run(fake, [item("the logo", 5000)]);
  await assert.rejects(promise, /deposit address changed/);
  assert.equal(log.approvals.length, 0);
  assert.equal(log.payments.length, 0);
});

await test("other upload errors fail the upload (no payment prompt)", async () => {
  const fake = fakeTurbo({ uploadStatus: 500 });
  const { promise, log } = run(fake, [item("the logo", 5000)]);
  await assert.rejects(promise, /Arweave upload failed \(500\)/);
  assert.equal(log.approvals.length, 0);
});

await test("a stored id that isn't the item's own id is refused", async () => {
  const fake = fakeTurbo({ returnWrongId: true });
  const { promise } = run(fake, [item("the logo", 5000)]);
  await assert.rejects(promise, /unexpected id/);
});

await test("lamportsForWinc rounds up and adds a 10% margin", async () => {
  const turbo = { wincForLamports: async (l) => l * 7n };
  // 100 winc at 7 winc/lamport = 14.29 -> 15 lamports, +10% (1.5 -> 2) = 17.
  assert.equal(await lamportsForWinc(turbo, 100n), 17n);
});

console.log(`\n${passed} passed.`);
