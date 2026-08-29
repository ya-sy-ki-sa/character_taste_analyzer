import { existsSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";

const buildRoot = resolve(process.cwd(), "dist");
const candidates = [];

function findSecretArtifacts(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) findSecretArtifacts(path);
    else if (entry.isFile() && entry.name === ".dev.vars") candidates.push(path);
  }
}

findSecretArtifacts(buildRoot);

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue;
  const resolved = realpathSync(candidate);
  if (!resolved.startsWith(`${buildRoot}${sep}`) || !resolved.endsWith(`${sep}.dev.vars`)) {
    throw new Error(`Refusing to remove unexpected path: ${resolved}`);
  }
  unlinkSync(resolved);
  console.log(`Removed local secret artifact: ${resolved.slice(buildRoot.length + 1)}`);
}
