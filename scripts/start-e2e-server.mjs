import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const markerPath = join(process.cwd(), ".wrangler", "e2e-state-path");
mkdirSync(dirname(markerPath), { recursive: true });
function removeState(path) {
  const resolved = String(path).trim();
  const prefix = join(tmpdir(), "character-taste-e2e-");
  if (!resolved.startsWith(prefix) || resolved.slice(prefix.length).includes("/"))
    throw new Error(`Refusing to remove unexpected E2E state path: ${resolved}`);
  rmSync(resolved, { recursive: true, force: true });
}
if (existsSync(markerPath)) {
  removeState(readFileSync(markerPath, "utf8"));
  unlinkSync(markerPath);
}
const statePath = mkdtempSync(join(tmpdir(), "character-taste-e2e-"));
writeFileSync(markerPath, `${statePath}\n`, { mode: 0o600 });
const npmCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const migration = spawnSync(
  npmCommand,
  [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "character-taste-lab-v2-clean-local",
    "--local",
    "--env",
    "offline",
    "--persist-to",
    statePath,
    "--config",
    "wrangler.jsonc",
  ],
  { stdio: "inherit", env: { ...process.env, CLOUDFLARE_ENV: "offline" } },
);
if (migration.status !== 0) {
  removeState(statePath);
  if (existsSync(markerPath)) unlinkSync(markerPath);
  process.exit(migration.status ?? 1);
}

const server = spawn(npmCommand, ["vite", "--host", "127.0.0.1", "--port", "41737", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_ENV: "offline", E2E_STATE_PATH: statePath },
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code, signal) => {
  removeState(statePath);
  if (existsSync(markerPath)) unlinkSync(markerPath);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
