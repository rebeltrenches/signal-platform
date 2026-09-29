// Downloads the official OFAC SDN list (SDN.XML from Treasury's Sanctions
// List Service), extracts its digital currency addresses and writes the
// small JSON file the Worker screens wallets against.
//
//   node scripts/ofac-sdn-list.mjs <output.json>
//
// Run on a schedule by .github/workflows/ofac-sdn-list.yml, which publishes
// the file to the `ofac-data` branch. Exits non-zero (writing nothing) if
// the download fails or doesn't look like the real list, so a bad run never
// replaces a good file.
import { writeFile } from "node:fs/promises";
import { SDN_XML_URL, parseSdnXml, buildListFile } from "../functions/ofac-sdn.js";

const output = process.argv[2];
if (!output) {
  console.error("usage: node scripts/ofac-sdn-list.mjs <output.json>");
  process.exit(2);
}

const response = await fetch(SDN_XML_URL, { signal: AbortSignal.timeout(180_000) });
if (!response.ok || !response.body) {
  console.error(`SDN download failed: HTTP ${response.status}`);
  process.exit(1);
}
const file = buildListFile(await parseSdnXml(response.body));
await writeFile(output, JSON.stringify(file, null, 1) + "\n");
console.log(`SDN list published ${file.publishDate}: ${file.count} digital currency addresses`, JSON.stringify(file.currencies));
