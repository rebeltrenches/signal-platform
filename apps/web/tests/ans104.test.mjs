// ans104.js: builds and signs ANS-104 data items the way a Solana wallet
// would (ed25519 over the hex of the deep hash), then parses the bytes
// back and verifies them independently with Node's crypto, as a bundler
// does. The deep hash and layout were also checked against 536 real data
// items from Arweave bundles (all four signature types, including
// Solana's) when this was written.
//
// Run with: node apps/web/tests/ans104.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const esm = await mkdtemp(join(tmpdir(), "ans104-"));
await cp("apps/web/src/client/ans104.js", join(esm, "ans104.js"));
await writeFile(join(esm, "package.json"), '{ "type": "module" }');
const ans = await import(pathToFileURL(join(esm, "ans104.js")).href);

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

// A Solana wallet: an ed25519 key whose raw 32-byte public key is the owner.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const owner = new Uint8Array(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const signed = [];
const signMessage = async (message) => {
  signed.push(new TextDecoder().decode(message));
  return new Uint8Array(crypto.sign(null, message, privateKey));
};

// Independent parser for the serialized item.
function parse(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const type = view.getUint16(o, true); o += 2;
  const signature = bytes.slice(o, o + 64); o += 64;
  const itemOwner = bytes.slice(o, o + 32); o += 32;
  const hasTarget = bytes[o++]; if (hasTarget) o += 32;
  const hasAnchor = bytes[o++]; if (hasAnchor) o += 32;
  const tagCount = Number(view.getBigUint64(o, true)); o += 8;
  const tagBytesLength = Number(view.getBigUint64(o, true)); o += 8;
  const tagBytes = bytes.slice(o, o + tagBytesLength); o += tagBytesLength;
  return { type, signature, owner: itemOwner, hasTarget, hasAnchor, tagCount, tagBytes, data: bytes.slice(o) };
}

// Reference deep hash written separately from the module (Node crypto, sync).
function referenceDeepHash(data) {
  const sha384 = (b) => crypto.createHash("sha384").update(b).digest();
  if (Array.isArray(data)) {
    let acc = sha384(Buffer.from(`list${data.length}`));
    for (const chunk of data) acc = sha384(Buffer.concat([acc, referenceDeepHash(chunk)]));
    return acc;
  }
  return sha384(Buffer.concat([sha384(Buffer.from(`blob${data.byteLength}`)), sha384(data)]));
}

console.log("ans104.test.mjs\n");

await test("tags are Avro-encoded: zigzag varint counts/lengths, then a 0 terminator", () => {
  const encoded = ans.encodeTags([{ name: "Content-Type", value: "image/png" }]);
  assert.deepEqual(
    Buffer.from(encoded).toString("hex"),
    "02" + "18" + Buffer.from("Content-Type").toString("hex") + "12" + Buffer.from("image/png").toString("hex") + "00",
  );
  // A 100-byte value's length (200 zigzagged) takes two varint bytes: c8 01.
  const long = ans.encodeTags([{ name: "A", value: "v".repeat(100) }]);
  assert.deepEqual(Array.from(long.slice(0, 5)), [0x02, 0x02, 0x41, 0xc8, 0x01]);
  assert.equal(ans.encodeTags([]).length, 0);
  assert.throws(() => ans.encodeTags([{ name: "", value: "x" }]));
  assert.throws(() => ans.encodeTags([{ name: "x", value: "" }]));
  assert.throws(() => ans.encodeTags([{ name: "x", value: "v".repeat(3073) }]));
});

await test("the deep hash matches an independently written reference", async () => {
  const cases = [
    new Uint8Array(0),
    Buffer.from("hello"),
    [Buffer.from("dataitem"), Buffer.from("1"), [Buffer.from("nested"), new Uint8Array(1000)]],
    [],
  ];
  for (const value of cases) {
    assert.deepEqual(Buffer.from(await ans.deepHash(value)), referenceDeepHash(value));
  }
});

const data = new TextEncoder().encode('{"name":"Signal Coin"}');
const tags = [{ name: "Content-Type", value: "application/json" }, { name: "App-Name", value: "Signal" }];
const item = await ans.createSignedDataItem({ owner, tags, data, signMessage });
const parsed = parse(item.bytes);

await test("layout: signature type 4 (Solana), 64-byte signature, 32-byte owner, no target/anchor, tags, data", () => {
  assert.equal(parsed.type, 4);
  assert.deepEqual(parsed.owner, owner);
  assert.equal(parsed.hasTarget, 0);
  assert.equal(parsed.hasAnchor, 0);
  assert.equal(parsed.tagCount, 2);
  assert.deepEqual(parsed.tagBytes, ans.encodeTags(tags));
  assert.deepEqual(parsed.data, data);
  assert.equal(item.bytes.length, 2 + 64 + 32 + 1 + 1 + 8 + 8 + parsed.tagBytes.length + data.length);
});

await test("the wallet is asked to sign readable text: the hex of the deep hash", () => {
  assert.equal(signed.length, 1);
  assert.match(signed[0], /^[0-9a-f]{96}$/);
});

await test("a verifier accepts it: ed25519 over hex(deepHash(item fields)) with the owner key", () => {
  const hash = referenceDeepHash([
    Buffer.from("dataitem"), Buffer.from("1"), Buffer.from("4"),
    Buffer.from(parsed.owner), Buffer.alloc(0), Buffer.alloc(0), Buffer.from(parsed.tagBytes), Buffer.from(parsed.data),
  ]);
  assert.equal(crypto.verify(null, Buffer.from(hash.toString("hex")), publicKey, parsed.signature), true);
});

await test("and rejects it if the data is changed after signing", () => {
  const tampered = Buffer.from(parsed.data);
  tampered[0] ^= 1;
  const hash = referenceDeepHash([
    Buffer.from("dataitem"), Buffer.from("1"), Buffer.from("4"),
    Buffer.from(parsed.owner), Buffer.alloc(0), Buffer.alloc(0), Buffer.from(parsed.tagBytes), tampered,
  ]);
  assert.equal(crypto.verify(null, Buffer.from(hash.toString("hex")), publicKey, parsed.signature), false);
});

await test("the id is base64url(SHA-256(signature)) — known before uploading", () => {
  const expected = crypto.createHash("sha256").update(parsed.signature).digest("base64url");
  assert.equal(item.id, expected);
  assert.match(item.id, /^[A-Za-z0-9_-]{43}$/);
});

await test("signing the same content again gives the same id (ed25519 is deterministic)", async () => {
  const again = await ans.createSignedDataItem({ owner, tags, data, signMessage });
  assert.equal(again.id, item.id);
});

await test("refuses a wrong-sized owner or a wallet signature that isn't 64 bytes", async () => {
  await assert.rejects(ans.createSignedDataItem({ owner: new Uint8Array(31), tags, data, signMessage }), /32-byte/);
  await assert.rejects(
    ans.createSignedDataItem({ owner, tags, data, signMessage: async () => new Uint8Array(63) }),
    /invalid signature/,
  );
});

console.log(`\n${passed} passed.`);
