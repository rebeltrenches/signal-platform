// token-metadata.js against the real @solana/web3.js and spl-token:
// input rules, the exact CreateMetadataAccountV3 encoding, the launch's
// mint transaction with metadata (size, integrity check), and decoding a
// metadata account that the real Token Metadata program wrote.
//
// Run with: node apps/web/tests/token-metadata.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");

// apps/web is "type": "commonjs"; load the browser modules from an ESM folder.
const esm = await mkdtemp(join(tmpdir(), "token-metadata-"));
for (const file of ["token-metadata.js", "launch-integrity.js"]) await cp(`apps/web/src/client/${file}`, join(esm, file));
await writeFile(join(esm, "package.json"), '{ "type": "module" }');
const tm = await import(pathToFileURL(join(esm, "token-metadata.js")).href);
const { launchTransactionDifference } = await import(pathToFileURL(join(esm, "launch-integrity.js")).href);

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const creator = web3.Keypair.generate();
const mintKeypair = web3.Keypair.generate();
const mint = mintKeypair.publicKey;
const URI = "https://arweave.net/" + "x".repeat(43);

console.log("token-metadata.test.mjs\n");

// ---- input rules --------------------------------------------------------
test("names: trimmed, 1..32 UTF-8 bytes, no control characters", () => {
  assert.deepEqual(tm.validateTokenName("  Signal Coin  "), { valid: true, error: null, value: "Signal Coin" });
  assert.equal(tm.validateTokenName("").valid, false);
  assert.equal(tm.validateTokenName("   ").valid, false);
  assert.equal(tm.validateTokenName("a".repeat(32)).valid, true);
  assert.equal(tm.validateTokenName("a".repeat(33)).valid, false);
  // 16 two-byte characters fit; 17 don't — the limit is bytes, not characters.
  assert.equal(tm.validateTokenName("é".repeat(16)).valid, true);
  assert.equal(tm.validateTokenName("é".repeat(17)).valid, false);
  assert.equal(tm.validateTokenName("🚀".repeat(8)).valid, true);
  assert.equal(tm.validateTokenName("🚀".repeat(9)).valid, false);
  assert.equal(tm.validateTokenName("Bad\u0000Name").valid, false);
});

test("symbols: upper-cased, 1..10 UTF-8 bytes, no spaces", () => {
  assert.deepEqual(tm.validateTokenSymbol(" sig "), { valid: true, error: null, value: "SIG" });
  assert.equal(tm.validateTokenSymbol("").valid, false);
  assert.equal(tm.validateTokenSymbol("ABCDEFGHIJ").valid, true);
  assert.equal(tm.validateTokenSymbol("ABCDEFGHIJK").valid, false);
  assert.equal(tm.validateTokenSymbol("SIG COIN").valid, false);
  // "ß" upper-cases to "SS": the limit applies to what is stored.
  assert.equal(tm.validateTokenSymbol("ßßßßß").value, "SSSSSSSSSS");
  assert.equal(tm.validateTokenSymbol("ßßßßßß").valid, false);
  assert.equal(tm.validateTokenSymbol("ÉÉÉÉÉ").valid, true);
  assert.equal(tm.validateTokenSymbol("ÉÉÉÉÉÉ").valid, false);
});

test("descriptions: optional, at most 500 characters", () => {
  assert.equal(tm.validateDescription("").valid, true);
  assert.equal(tm.validateDescription("x".repeat(500)).valid, true);
  assert.equal(tm.validateDescription("x".repeat(501)).valid, false);
});

const png = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
test("logos: PNG/JPEG/GIF/WebP identified from their bytes, up to 100 KB", () => {
  assert.deepEqual(tm.validateLogo(png(1000)), { valid: true, error: null, contentType: "image/png" });
  assert.equal(tm.validateLogo(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0)).contentType, "image/jpeg");
  assert.equal(tm.validateLogo(new TextEncoder().encode("GIF89a......")).contentType, "image/gif");
  assert.equal(tm.validateLogo(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")).contentType, "image/webp");
  assert.equal(tm.validateLogo(png(100 * 1024)).valid, true);
  const tooBig = tm.validateLogo(png(100 * 1024 + 1));
  assert.equal(tooBig.valid, false);
  assert.match(tooBig.error, /maximum is 100 KB/);
  assert.equal(tm.validateLogo(new Uint8Array(0)).valid, false);
  assert.equal(tm.validateLogo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')).valid, false);
  assert.equal(tm.validateLogo(new TextEncoder().encode("not an image at all")).valid, false);
});

test("the metadata JSON follows the Metaplex fungible standard", () => {
  const json = JSON.parse(new TextDecoder().decode(tm.buildMetadataJson({
    name: "Signal Coin", symbol: "SIG", description: "d", imageUri: "https://arweave.net/img", imageType: "image/png",
  })));
  assert.deepEqual(json, {
    name: "Signal Coin",
    symbol: "SIG",
    description: "d",
    image: "https://arweave.net/img",
    properties: { category: "image", files: [{ uri: "https://arweave.net/img", type: "image/png" }] },
  });
});

// ---- the instruction ----------------------------------------------------
const ix = tm.createMetadataInstruction(web3, {
  mint, mintAuthority: creator.publicKey, payer: creator.publicKey, name: "Signal Coin", symbol: "SIG", uri: URI,
});

test("the metadata account is the Metaplex PDA [\"metadata\", program, mint]", () => {
  const programId = new web3.PublicKey(tm.TOKEN_METADATA_PROGRAM_ID);
  const [expected] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), programId.toBuffer(), mint.toBuffer()], programId,
  );
  assert.equal(tm.metadataAddress(web3, mint).toBase58(), expected.toBase58());
});

test("CreateMetadataAccountV3 data is byte-exact: no royalties/creators/collection/uses, isMutable false", () => {
  const str = (s) => [...new Uint8Array(new Uint32Array([Buffer.byteLength(s)]).buffer), ...Buffer.from(s)];
  const expected = Uint8Array.from([33, ...str("Signal Coin"), ...str("SIG"), ...str(URI), 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Uint8Array.from(ix.data), expected);
  assert.equal(ix.programId.toBase58(), "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
});

test("accounts: metadata (w), mint, mint authority (s), payer (s,w), update authority (s), system program", () => {
  const keys = ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);
  assert.deepEqual(keys, [
    [tm.metadataAddress(web3, mint).toBase58(), false, true],
    [mint.toBase58(), false, false],
    [creator.publicKey.toBase58(), true, false],
    [creator.publicKey.toBase58(), true, true],
    [creator.publicKey.toBase58(), true, false],
    [web3.SystemProgram.programId.toBase58(), false, false],
  ]);
});

test("the instruction refuses names, symbols and URIs outside the rules", () => {
  const build = (fields) => () => tm.createMetadataInstruction(web3, {
    mint, mintAuthority: creator.publicKey, payer: creator.publicKey, name: "Ok", symbol: "OK", uri: URI, ...fields,
  });
  assert.throws(build({ name: "a".repeat(33) }));
  assert.throws(build({ name: " padded " }), /name/i);
  assert.throws(build({ symbol: "lower" }), /symbol/i);
  assert.throws(build({ symbol: "ABCDEFGHIJK" }));
  assert.throws(build({ uri: "http://arweave.net/x" }), /URI/);
  assert.throws(build({ uri: "https://" + "a".repeat(200) }), /URI/);
});

// ---- the launch's mint transaction ---------------------------------------
function mintTransaction(name, symbol, uri) {
  const tx = new web3.Transaction().add(
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    web3.SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: new web3.PublicKey("HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg"), lamports: 1_000_000 }),
    web3.SystemProgram.createAccount({ fromPubkey: creator.publicKey, newAccountPubkey: mint, space: spl.MINT_SIZE, lamports: 1_461_600, programId: spl.TOKEN_PROGRAM_ID }),
    spl.createInitializeMintInstruction(mint, 6, creator.publicKey, null, spl.TOKEN_PROGRAM_ID),
    tm.createMetadataInstruction(web3, { mint, mintAuthority: creator.publicKey, payer: creator.publicKey, name, symbol, uri }),
  );
  tx.feePayer = creator.publicKey;
  tx.recentBlockhash = web3.Keypair.generate().publicKey.toBase58();
  tx.sign(creator, mintKeypair);
  return tx;
}

test("with the longest allowed name, symbol and an Arweave URI, the signed mint transaction fits (≤1232 bytes)", () => {
  const tx = mintTransaction("🚀".repeat(8), "ÉÉÉÉÉ", "https://arweave.net/" + "a".repeat(43));
  const size = tx.serialize().length;
  assert.ok(size <= 1232, `transaction is ${size} bytes`);
  assert.ok(tx.verifySignatures());
});

test("the launch integrity check accepts the mint transaction with metadata unchanged, and rejects an edited name", () => {
  const tx = mintTransaction("Signal Coin", "SIG", URI);
  assert.equal(launchTransactionDifference(web3, tx.compileMessage(), tx.compileMessage()), null);
  const edited = mintTransaction("Signal Coin!", "SIG", URI);
  edited.recentBlockhash = tx.recentBlockhash;
  assert.match(launchTransactionDifference(web3, tx.compileMessage(), edited.compileMessage()), /data changed/);
});

// ---- decoding what the real program wrote -------------------------------
// Captured from a Solana Devnet simulation (2026-09-27) of the launch
// transactions using this module's instruction: the Token Metadata
// program's own output for mint 8NPC…VsZ.
const DEVNET_METADATA_ACCOUNT =
  "BHlybaUtmdYLB+rXOy9vC/YIPMhcd6lONNaR14+Lyv7JbXwa1cLNVUt0D0wKiZdUSnS5JZifHll993rXYnEpxsQgAAAAzqkgU2lnbmFsIERldm5ldCBDaGVjayDwn5qAAAAAAAAKAAAAU0lHQ0hLAAAAAMgAAABodHRwczovL2Fyd2VhdmUubmV0L0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf0BAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ==";

test("decodes the account the real Token Metadata program created: padded strings trimmed, isMutable false", () => {
  const decoded = tm.decodeMetadataAccount(Buffer.from(DEVNET_METADATA_ACCOUNT, "base64"));
  assert.equal(decoded.name, "Ω Signal Devnet Check 🚀");
  assert.equal(decoded.symbol, "SIGCHK");
  assert.equal(decoded.uri, "https://arweave.net/" + "A".repeat(43));
  assert.equal(decoded.sellerFeeBasisPoints, 0);
  assert.equal(decoded.isMutable, false);
  assert.equal(new web3.PublicKey(decoded.mint).toBase58(), "8NPCV3YrcQbxYXE8jTBA37LsuZL6muMPjdVdspuPyVsZ");
  assert.equal(new web3.PublicKey(decoded.updateAuthority).toBase58(), "9B5XszUGdMaxCZ7uSQhPzdks5ZQSmWxrmzCSvtJ6Ns6g");
});

test("refuses to decode an account that isn't token metadata", () => {
  assert.throws(() => tm.decodeMetadataAccount(new Uint8Array(100)), /Not a token metadata account/);
});

console.log(`\n${passed} passed.`);
