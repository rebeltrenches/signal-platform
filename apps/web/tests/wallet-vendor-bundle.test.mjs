// Regression test for audit item C4: wallet code is bundled at build time
// from pinned versions and served from our own origin, never imported
// from a CDN at runtime.
//
// Run after the web build: node apps/web/tests/wallet-vendor-bundle.test.mjs
import assert from "node:assert/strict";
import { readFile, readdir, access, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT = "apps/web/src/client";
const VENDOR = "apps/web/dist/client/vendor";
let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    console.log(`  ok  - ${name}`);
    passed++;
  });
}

// --- Source: no runtime imports from any URL ---
await test("no client script imports code from an http(s) URL", async () => {
  for (const file of await readdir(CLIENT)) {
    const source = await readFile(`${CLIENT}/${file}`, "utf8");
    assert.doesNotMatch(source, /(import\s[^;]*?from\s*|import\s*\(\s*)["']https?:/, `${file} imports from a URL`);
    assert.doesNotMatch(source, /esm\.sh/, `${file} mentions esm.sh`);
  }
});
await test("launch and swap code import the local bundles", async () => {
  const launch = await readFile(`${CLIENT}/launch-solana.js`, "utf8");
  const swap = await readFile(`${CLIENT}/swap-execute.js`, "utf8");
  assert.match(launch, /import \* as web3 from "\.\/vendor\/solana-web3\.js";/);
  assert.match(launch, /import \* as splToken from "\.\/vendor\/spl-token\.js";/);
  assert.match(swap, /import \* as web3 from "\.\/vendor\/solana-web3\.js";/);
});

// --- Pinned, exact versions ---
await test("the bundled libraries are pinned to exact versions", async () => {
  const pkg = JSON.parse(await readFile("apps/web/package.json", "utf8"));
  assert.deepEqual(
    {
      web3: pkg.devDependencies["@solana/web3.js"],
      splToken: pkg.devDependencies["@solana/spl-token"],
      buffer: pkg.devDependencies.buffer,
      esbuild: pkg.devDependencies.esbuild,
    },
    { web3: "1.95.3", splToken: "0.4.9", buffer: "6.0.3", esbuild: "0.28.2" },
  );
});

// --- The built bundles work in a browser-like global scope ---
await test("the build produced both vendor bundles", async () => {
  await access(`${VENDOR}/solana-web3.js`);
  await access(`${VENDOR}/spl-token.js`);
});

// apps/web is "type": "commonjs", so Node would read the bundles as CJS;
// load a copy from a folder marked as ES modules, as browsers treat them.
const esmCopy = await mkdtemp(join(tmpdir(), "wallet-vendor-"));
await cp(VENDOR, esmCopy, { recursive: true });
await writeFile(join(esmCopy, "package.json"), '{ "type": "module" }');

// Browsers have no global Buffer; spl-token needs the injected one.
const nodeBuffer = globalThis.Buffer;
delete globalThis.Buffer;
const web3 = await import(pathToFileURL(join(esmCopy, "solana-web3.js")).href);
const spl = await import(pathToFileURL(join(esmCopy, "spl-token.js")).href);

await test("the bundles load without a global Buffer, and do not add one", () => {
  assert.equal(typeof globalThis.Buffer, "undefined");
});
await test("spl-token shares web3.js's classes (one bundled copy)", () => {
  assert.ok(spl.TOKEN_PROGRAM_ID instanceof web3.PublicKey);
});
await test("the launch instructions encode correctly", () => {
  const payer = web3.Keypair.generate().publicKey;
  const mintKeypair = web3.Keypair.generate();
  const mint = mintKeypair.publicKey;
  const ata = spl.getAssociatedTokenAddressSync(mint, payer, false, spl.TOKEN_PROGRAM_ID);
  const amount = 100_000_000n * 10n ** 6n;
  const mintTo = spl.createMintToInstruction(mint, ata, payer, amount, [], spl.TOKEN_PROGRAM_ID);
  const revoke = spl.createSetAuthorityInstruction(mint, payer, spl.AuthorityType.MintTokens, null, [], spl.TOKEN_PROGRAM_ID);
  assert.equal(new DataView(mintTo.data.buffer, mintTo.data.byteOffset).getBigUint64(1, true), amount);
  assert.deepEqual([...revoke.data.subarray(0, 3)], [6, 0, 0]); // SetAuthority, MintTokens, None

  const tx = new web3.Transaction().add(
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
    web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    web3.SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, space: spl.MINT_SIZE, lamports: 1, programId: spl.TOKEN_PROGRAM_ID }),
    spl.createInitializeMintInstruction(mint, 6, payer, null, spl.TOKEN_PROGRAM_ID),
    spl.createAssociatedTokenAccountInstruction(payer, ata, payer, mint, spl.TOKEN_PROGRAM_ID),
    mintTo,
    revoke,
  );
  tx.recentBlockhash = web3.Keypair.generate().publicKey.toBase58();
  tx.feePayer = payer;
  tx.partialSign(mintKeypair);
  const versioned = new web3.VersionedTransaction(tx.compileMessage());
  assert.equal(versioned.serialize().length, tx.serialize({ requireAllSignatures: false }).length);
});
await test("mint accounts decode (used by the supply-lock read-back)", () => {
  const data = new Uint8Array(spl.MINT_SIZE);
  new DataView(data.buffer).setBigUint64(36, 123n, true);
  data[44] = 6;
  data[45] = 1;
  const mint = spl.unpackMint(web3.Keypair.generate().publicKey, { data, owner: spl.TOKEN_PROGRAM_ID, lamports: 1, executable: false });
  assert.equal(mint.mintAuthority, null);
  assert.equal(mint.supply, 123n);
  assert.equal(mint.decimals, 6);
});
globalThis.Buffer = nodeBuffer;
await rm(esmCopy, { recursive: true, force: true });

console.log(`\n${passed} test(s) passed.`);
