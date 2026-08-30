import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function teardownE2eState() {
  const markerPath = join(process.cwd(), ".wrangler", "e2e-state-path");
  if (!existsSync(markerPath)) return;
  const statePath = readFileSync(markerPath, "utf8").trim();
  const prefix = join(tmpdir(), "character-taste-e2e-");
  if (!statePath.startsWith(prefix) || statePath.slice(prefix.length).includes("/"))
    throw new Error(`Refusing to remove unexpected E2E state path: ${statePath}`);
  rmSync(statePath, { recursive: true, force: true });
  unlinkSync(markerPath);
}
