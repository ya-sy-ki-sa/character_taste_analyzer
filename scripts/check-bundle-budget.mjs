import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const directory = "dist/client";
const { chunks } = JSON.parse(readFileSync(`${directory}/build-dependencies.json`, "utf8"));
const manifest = JSON.parse(readFileSync(`${directory}/.vite/manifest.json`, "utf8"));
const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
const closure = (roots) => {
  const files = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    const chunk = byFile.get(file);
    if (!chunk) throw new Error(`Missing dependency metadata: ${file}`);
    files.add(file);
    chunk.imports.forEach(visit);
  };
  roots.forEach(visit);
  return files;
};
const initial = closure(chunks.filter((chunk) => chunk.entry).map((chunk) => chunk.file));
if (!initial.size) throw new Error("No entry chunk in build metadata");
const measure = (files) =>
  [...files].reduce((total, file) => {
    const data = readFileSync(`${directory}/${file}`);
    if (!data.length) throw new Error(`Empty asset: ${file}`);
    return total + gzipSync(data).byteLength;
  }, 0);
const results = {};
function check(name, files, budget) {
  const bytes = measure(files);
  if (!files.size) throw new Error(`No assets found for ${name}`);
  if (bytes > budget) throw new Error(`${name}: ${bytes}B exceeds ${budget}B gzip`);
  results[name] = { gzipBytes: bytes, budget, files: [...files].sort() };
}
check("initial", initial, 110_000);
for (const module of [
  "EntriesPage",
  "GeneratePage",
  "ProfilePage",
  "SettingsPage",
  "AnalyzerStatusPage",
  "TasteGraph",
]) {
  const roots = chunks
    .filter((chunk) => chunk.modules.some((id) => id.endsWith(`/${module}.tsx`)))
    .map((chunk) => chunk.file);
  const files = closure(roots);
  for (const file of initial) files.delete(file);
  const budget = module === "EntriesPage" ? 55_000 : module === "TasteGraph" ? 65_000 : 25_000;
  check(module, files, budget);
}
const css = new Set(
  Object.values(manifest).flatMap((asset) => [
    ...(asset.css ?? []),
    ...(asset.file.endsWith(".css") ? [asset.file] : []),
  ]),
);
check("css", css, 20_000);
for (const file of initial) {
  for (const id of byFile.get(file).modules) {
    if (
      /^(?:worker|evaluation|tests|scripts|archive)\//u.test(id) ||
      id.startsWith("shared/contracts/") ||
      id.includes("/zod/") ||
      id.includes("/sigma/") ||
      id.includes("/graphology")
    )
      throw new Error(`Unexpected initial dependency: ${id}`);
  }
}
console.log(JSON.stringify(results, null, 2));
