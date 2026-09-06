import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function liveRunRoot(value = process.env.LIVE_RUN_DIR) {
  if (!value) throw new Error("LIVE_RUN_DIR is required; use a new directory for each measurement");
  const root = resolve(value);
  if (existsSync(`${root}/final-artifact-manifest.json`))
    throw new Error("Finalized live evaluation is read-only; use a new run directory");
  return root;
}

export function digest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
export function preserveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}
export function sameInput(a, b) {
  const keys = [
    "registrationType",
    "workTitle",
    "characterName",
    "mediaType",
    "preferenceContext",
    "userCharacterView",
    "referenceMaterial",
  ];
  return (
    keys.every((k) => (a[k] ?? "") === (b[k] ?? "")) &&
    ["likedReasons", "dislikedReasons", "valueStanceNote"].every(
      (k) => (a.preference[k] ?? "") === (b.preference[k] ?? ""),
    ) &&
    JSON.stringify(a.preference.responseChannels ?? []) === JSON.stringify(b.preference.responseChannels ?? [])
  );
}
export function selectResumeEntry(matches) {
  if (matches.length > 1) throw new Error("AMBIGUOUS_EXISTING_ENTRIES: refusing duplicate submission");
  return matches[0] ?? null;
}
