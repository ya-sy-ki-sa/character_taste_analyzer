import { spawn } from "node:child_process";
import { liveRunRoot, readJson } from "../evaluation/live-personas/storage.mjs";

const root = liveRunRoot();
const dataset = readJson(`${root}/dataset.json`);
for (;;) {
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ["scripts/grade-live-personas.mjs"], { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", done);
  });
  if (code !== 0) throw new Error(`Grading stopped (${code}); inspect saved raw response before resuming`);
  const progress = readJson(`${root}/progress.json`);
  const remaining = dataset.cases.filter(
    (c) => !new Set(["complete", "failed", "held", "submission_failed"]).has(progress.cases[c.id]?.status),
  );
  const ungraded = dataset.cases.filter(
    (c) =>
      readJson(`${root}/cases/${c.id}/preference-before.json`, null) &&
      !readJson(`${root}/grading-v2/${c.id}.json`, null),
  );
  if (!remaining.length && !ungraded.length) break;
  console.log("Waiting for baseline outputs", remaining.length, "cases pending");
  await new Promise((r) => setTimeout(r, 30000));
}
