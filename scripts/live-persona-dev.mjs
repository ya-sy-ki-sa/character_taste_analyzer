import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, openSync } from "node:fs";
import { join } from "node:path";
import { liveRunRoot } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = liveRunRoot();
const state = join(root, "runtime-state");
if (!existsSync(state)) throw new Error("Apply local D1 migrations to LIVE_RUN_DIR/runtime-state before starting dev");
const log = join(root, "app.log");
const resume = process.argv.length === 3 && process.argv[2] === "--resume";
if (process.argv.length > 2 && !resume) throw new Error("Only --resume is supported");
if (resume && !existsSync(log)) throw new Error("Cannot resume: run application log is missing");
const flags =
  constants.O_WRONLY | constants.O_NOFOLLOW | (resume ? constants.O_APPEND : constants.O_CREAT | constants.O_EXCL);
const fd = openSync(log, flags, 0o600);
const info = fstatSync(fd);
if (!info.isFile() || (info.mode & 0o077) !== 0) {
  closeSync(fd);
  throw new Error("Application log must be a private regular file");
}
const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  cwd: process.cwd(),
  env: { ...process.env, E2E_STATE_PATH: state },
  detached: true,
  stdio: ["ignore", fd, fd],
});
closeSync(fd);
console.log(`Live dev server PID ${child.pid}; ${resume ? "appending to" : "created"} private application log: ${log}`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    if (child.pid) process.kill(-child.pid, signal);
  });
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (!stopping && code !== 0) console.error(`Live dev server exited: ${signal ?? code}`);
  process.exitCode = code ?? (stopping ? 0 : 1);
});
