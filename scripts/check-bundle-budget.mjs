import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const assetDirectory = "dist/client/assets";
const files = readdirSync(assetDirectory).filter((file) => file.endsWith(".js"));
const budgets = { main: 190_000, graph: 330_000 };
let mainTotal = 0;
let graphTotal = 0;
for (const file of files) {
  const path = join(assetDirectory, file);
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  if (/TasteGraph/iu.test(file)) graphTotal += gzipBytes;
  else if (/index|App/iu.test(file)) mainTotal += gzipBytes;
  if (statSync(path).size === 0) throw new Error(`empty bundle: ${basename(path)}`);
}
if (mainTotal > budgets.main) throw new Error(`main gzip budget exceeded: ${mainTotal} > ${budgets.main}`);
if (graphTotal > budgets.graph) throw new Error(`graph gzip budget exceeded: ${graphTotal} > ${budgets.graph}`);
console.log(`Bundle budget OK: main=${mainTotal}B graph=${graphTotal}B gzip`);
