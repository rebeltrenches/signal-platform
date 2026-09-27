// The platform fee recipient (treasury) is set in exactly one place,
// packages/config/src/platform-wallet.ts, and every fee path reads it
// from there. Run after the web build:
//   node apps/web/tests/fee-wallet-config.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const TREASURY = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg";
const OLD_WALLET = "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19";
// Decision-history entries that record the old address on purpose.
const HISTORY_FILES = new Set(["docs/ARCHITECTURE.md", "docs/ROADMAP.md", "apps/web/tests/fee-wallet-config.test.mjs"]);

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}
const read = (path) => readFile(path, "utf8");
function trackedFilesContaining(text) {
  const out = execFileSync("git", ["grep", "-l", "-F", text], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return out.split("\n").filter(Boolean);
}

await test("packages/config sets the treasury address", async () => {
  assert.match(await read("packages/config/src/platform-wallet.ts"), new RegExp(`SIGNAL_PLATFORM_WALLET_ADDRESS =\\s*'${TREASURY}'`));
});
await test("the address is written nowhere else in code (only history docs and this test)", () => {
  const files = trackedFilesContaining(TREASURY).filter((f) => !HISTORY_FILES.has(f) && !f.startsWith("apps/web/tests/") && f !== "packages/config/src/platform-wallet.ts" && !f.startsWith(".github/"));
  assert.deepEqual(files, []);
});
await test("the old fee wallet is gone except from decision history", () => {
  assert.deepEqual(trackedFilesContaining(OLD_WALLET).filter((f) => !HISTORY_FILES.has(f)), []);
});
await test("the build generates /client/platform-wallet.js from the config", async () => {
  assert.match(await read("apps/web/dist/client/platform-wallet.js"), new RegExp(`export const SIGNAL_PLATFORM_WALLET_ADDRESS = "${TREASURY}";`));
});
await test("the launch fee (browser) reads it", async () => {
  const source = await read("apps/web/src/client/launch-solana.js");
  assert.match(source, /import \{ SIGNAL_PLATFORM_WALLET_ADDRESS \} from "\.\/platform-wallet\.js";/);
  assert.match(source, /const SIGNAL_PLATFORM_WALLET = new web3\.PublicKey\(SIGNAL_PLATFORM_WALLET_ADDRESS\);/);
  assert.match(source, /toPubkey: SIGNAL_PLATFORM_WALLET,/);
});
await test("the swap fee (browser) reads it", async () => {
  const source = await read("apps/web/src/client/swap-execute.js");
  assert.match(source, /import \{ SIGNAL_PLATFORM_WALLET_ADDRESS \} from "\.\/platform-wallet\.js";/);
  assert.match(source, /const SIGNAL_FEE_WALLET = new web3\.PublicKey\(SIGNAL_PLATFORM_WALLET_ADDRESS\);/);
  assert.match(source, /toPubkey: SIGNAL_FEE_WALLET, lamports: feeLamports/);
});
await test("the launch fee (SolanaAdapter) reads it", async () => {
  const source = await read("packages/blockchain/src/solana/SolanaAdapter.ts");
  assert.match(source, /import \{ SIGNAL_PLATFORM_WALLET_ADDRESS \} from '@launchpad\/config';/);
  assert.match(source, /new PublicKey\(SIGNAL_PLATFORM_WALLET_ADDRESS\)/);
});

console.log(`\n${passed} test(s) passed.`);
