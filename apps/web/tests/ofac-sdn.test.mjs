// functions/ofac-sdn.js: parsing the official OFAC SDN.XML (as the
// scheduled GitHub job does) and building / validating the small list file
// the Worker screens wallets against. No network.
//
// Run with: node apps/web/tests/ofac-sdn.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("functions/ofac-sdn.js", "utf8");
const sdn = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ETH = "0x8576aCC5C05D6Ce88f4e49bf65BdF0C62F91353C";

/** SDN.XML in the real layout: other ID types must be ignored; filler keeps
 *  it above the "looks like the real list" size. */
function sdnXml(entries = 150) {
  const id = (type, number) => `<id><uid>1</uid><idType>${type}</idType><idNumber>${number}</idNumber></id>`;
  return `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns="https://tempuri.org/sdnList.xsd">
  <publshInformation><Publish_Date>09/23/2026</Publish_Date><Record_Count>1</Record_Count></publshInformation>
  <sdnEntry><lastName>TEST ENTITY</lastName><idList>
    ${id("Passport", "A1234567")}
    ${id("Digital Currency Address - SOL", SOL)}
    ${id("Digital Currency Address - ETH", ETH)}
  </idList></sdnEntry>
  ${Array.from({ length: entries }, (_, i) => id("Digital Currency Address - XBT", `1Filler${String(i).padStart(26, "x")}`)).join("\n")}
</sdnList>`;
}
function stream(text, chunk = 65536) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.subarray(i, i + chunk)); c.close(); } });
}

console.log("ofac-sdn.test.mjs\n");

await test("parser: keeps only digital currency addresses, lower-cases EVM ones, reads the publish date", async () => {
  const parsed = await sdn.parseSdnXml(stream(sdnXml()));
  assert.equal(parsed.publishDate, "09/23/2026");
  assert.ok(parsed.addresses.has(SOL));
  assert.ok(parsed.addresses.has(ETH.toLowerCase()) && !parsed.addresses.has(ETH));
  assert.ok(!parsed.addresses.has("A1234567"), "a passport number isn't an address");
  assert.deepEqual(parsed.currencies, { SOL: 1, ETH: 1, XBT: 150 });
});

await test("parser: entries split across stream chunks as small as 1 byte are all found", async () => {
  for (const size of [1, 7, 33, 4096]) {
    const parsed = await sdn.parseSdnXml(stream(sdnXml(), size));
    assert.equal(parsed.addresses.size, 152, `chunk size ${size}`);
  }
});

await test("list file: sorted addresses with count, source, dates; refuses a download that isn't plausibly the list", async () => {
  const now = Date.parse("2026-09-29T08:00:00Z");
  const file = sdn.buildListFile(await sdn.parseSdnXml(stream(sdnXml())), now);
  assert.equal(file.format, "signal-ofac-sdn-addresses/1");
  assert.equal(file.source, sdn.SDN_XML_URL);
  assert.equal(file.generatedAt, "2026-09-29T08:00:00.000Z");
  assert.equal(file.count, 152);
  assert.deepEqual(file.addresses, [...file.addresses].sort());
  await assert.rejects(async () => sdn.buildListFile(await sdn.parseSdnXml(stream(sdnXml(10))), now), /looked incomplete/);
});

await test("validation: a good file gives a lookup set (EVM in any case); bad ones are refused with a reason", async () => {
  const now = Date.parse("2026-09-29T08:00:00Z");
  const good = sdn.buildListFile(await sdn.parseSdnXml(stream(sdnXml())), now);
  const list = sdn.validateListFile(good, now + 60_000);
  assert.ok(list.addresses.has(SOL) && list.addresses.has(ETH.toLowerCase()));
  assert.equal(list.publishDate, "09/23/2026");
  const bad = (changes, at = now) => () => sdn.validateListFile({ ...good, ...changes }, at);
  assert.throws(bad({ format: "other" }), /expected format/);
  assert.throws(bad({ addresses: good.addresses.slice(0, 50), count: 50 }), /incomplete/);
  assert.throws(bad({ count: 999 }), /incomplete/);
  assert.throws(bad({ generatedAt: "not a date" }), /valid date/);
  assert.throws(bad({}, now + sdn.SDN_MAX_AGE_MS + 1), /too old/);
  assert.throws(bad({ generatedAt: new Date(now + 3 * 60 * 60_000).toISOString() }), /future/);
  assert.throws(() => sdn.validateListFile(null, now), /expected format/);
});

await test("validation: entries that can't be addresses are ignored, and too few real ones is refused", () => {
  const now = Date.parse("2026-09-29T08:00:00Z");
  const addresses = [...Array.from({ length: 120 }, (_, i) => `1Filler${String(i).padStart(26, "x")}`), "<script>alert(1)</script>", "x"];
  const file = { format: "signal-ofac-sdn-addresses/1", generatedAt: new Date(now).toISOString(), count: addresses.length, addresses };
  const list = sdn.validateListFile(file, now);
  assert.equal(list.addresses.size, 120);
  const mostlyJunk = { ...file, addresses: [...addresses.slice(0, 60), ...Array(80).fill("<junk>")], count: 140 };
  assert.throws(() => sdn.validateListFile(mostlyJunk, now), /incomplete/);
});

console.log(`\n${passed} passed.`);
