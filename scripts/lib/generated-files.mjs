import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeOrCheckArtifacts(artifacts, check) {
  const changed = [];
  for (const [path, output] of artifacts) {
    if (existsSync(path) && readFileSync(path, "utf8") === output) continue;
    changed.push(path);
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, output);
    }
  }
  if (check && changed.length)
    throw new Error(`Generated assets are stale; run npm run assets:generate:\n${changed.join("\n")}`);
  console.log(`${check ? "Verified" : "Generated"} ${artifacts.size} assets (${changed.length} changed)`);
}
