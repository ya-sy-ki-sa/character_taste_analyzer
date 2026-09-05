import { resolve } from "node:path";
import { digest, readJson, saveJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
const dataset = readJson(`${root}/dataset.json`);
const progress = readJson(`${root}/progress.json`);
const tally = (values) =>
  values.reduce((m, x) => {
    m[x] = (m[x] ?? 0) + 1;
    return m;
  }, {});
const identity = (x) => digest([x.stableKey, x.responseChannel, x.condition]);
const personas = dataset.personas.map((p) => {
  let previous = [];
  const snapshots = [5, 10, 15].flatMap((ordinal) => {
    const raw = readJson(`${root}/profiles/${p.id}/${ordinal}.json`, null);
    if (!raw) return [];
    const profile = raw.profile.profile;
    const dimensions = profile.dimensions;
    const current = new Set(dimensions.map(identity));
    const retained = previous.filter((x) => current.has(identity(x)));
    const lost = previous.filter((x) => !current.has(identity(x)));
    const out = {
      ordinal,
      activeEntryCount: profile.entryCount,
      dimensionCount: dimensions.length,
      classificationCounts: tally(dimensions.map((x) => x.classification)),
      channelCounts: tally(dimensions.map((x) => x.responseChannel)),
      unmappedCount: dimensions.filter((x) => x.flags.includes("unmapped")).length,
      multipleIdentityCount: dimensions.filter((x) => x.identityCount > 1).length,
      multipleWorkCount: dimensions.filter((x) => x.workCount > 1).length,
      retainedFromPrevious: retained.length,
      previousDimensionCount: previous.length,
      lost: lost.map((x) => ({ label: x.label, channel: x.responseChannel, condition: x.condition })),
      topFive: dimensions.slice(0, 5),
      negativePreferences: dimensions.filter((x) => x.negativeScore > 0),
      freshness: raw.profile.freshness.status,
      graphFreshness: raw.graph.freshness.status,
      profileGeneration: profile.generation,
      graphGeneration: raw.graph.graph.profileGeneration,
      graphNodeCounts: tally(raw.graph.graph.nodes.map((x) => x.type)),
      evidence: `profiles/${p.id}/${ordinal}.json`,
    };
    previous = dimensions;
    return [out];
  });
  const cases = dataset.cases.filter((c) => c.personaId === p.id);
  return {
    personaId: p.id,
    snapshots,
    plannedWorkCounts: tally(cases.map((c) => c.input.workTitle)),
    completedWorkCounts: tally(
      cases.filter((c) => progress.cases[c.id]?.status === "complete").map((c) => c.input.workTitle),
    ),
  };
});
saveJson(`${root}/profile-statistics.json`, { generatedAt: new Date().toISOString(), personas });
console.log(
  personas
    .map(
      (p) =>
        `${p.personaId}: ${p.snapshots.map((x) => `${x.ordinal}→${x.dimensionCount} dimensions (${x.retainedFromPrevious}/${x.previousDimensionCount} retained)`).join(", ")}`,
    )
    .join("\n"),
);
