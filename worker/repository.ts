import type { TasteProfile } from "../shared/schemas";
import { TAXONOMY_VERSION, TRAITS } from "../shared/taxonomy";
import {
  ALGORITHM_VERSION,
  buildTasteProfile,
  type EntryVector,
  type ProfileEvidence,
  type ProfileSignal,
} from "./domain/profile";
import { nowIso, sha256Hex } from "./lib/crypto";
import { all, first, run } from "./lib/db";
import type { EntryRevisionRow, Env, ProfileSnapshotRow } from "./types";

export async function ensureTaxonomy(db: D1Database): Promise<void> {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT OR IGNORE INTO taxonomy_versions (id, status, created_at) VALUES (?, 'active', ?)")
      .bind(TAXONOMY_VERSION, now),
    ...TRAITS.map(([id, label, category]) =>
      db
        .prepare("INSERT OR IGNORE INTO traits (id, taxonomy_version, label, category) VALUES (?, ?, ?, ?)")
        .bind(id, TAXONOMY_VERSION, label, category),
    ),
  ];
  const result = await db.batch(statements);
  if (result.some((item) => !item.success)) throw new Error("Could not seed taxonomy");
}

export async function loadCurrentEntryRevision(
  env: Env,
  userId: string,
  entryId: string,
): Promise<EntryRevisionRow | null> {
  return first<EntryRevisionRow>(
    env.DB.prepare(`
      SELECT er.*, e.kind
      FROM entries e
      JOIN entry_revisions er ON er.entry_id = e.id AND er.revision = e.current_revision
      WHERE e.id = ? AND e.user_id = ? AND e.status = 'active'
    `).bind(entryId, userId),
  );
}

export async function setJobStatus(
  env: Env,
  jobId: string,
  status: "queued" | "running" | "succeeded" | "failed" | "superseded",
  progress: number,
  options: { result?: unknown; errorCode?: string } = {},
): Promise<void> {
  await run(
    env.DB.prepare(`
      UPDATE jobs
      SET status = ?, progress = ?, result_json = ?, error_code = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      status,
      progress,
      options.result === undefined ? null : JSON.stringify(options.result),
      options.errorCode ?? null,
      nowIso(),
      jobId,
    ),
  );
}

export async function recordModelRun(
  env: Env,
  input: {
    id: string;
    userId: string;
    jobId?: string;
    task: string;
    provider: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    inputHash: string;
    outputHash?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    status: "succeeded" | "failed";
    errorCode?: string;
  },
): Promise<void> {
  await run(
    env.DB.prepare(`
      INSERT INTO model_runs (
        id, user_id, job_id, task, provider, model, prompt_version, schema_version,
        taxonomy_version, algorithm_version, input_hash, output_hash, input_tokens,
        output_tokens, latency_ms, status, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.id,
      input.userId,
      input.jobId ?? null,
      input.task,
      input.provider,
      input.model,
      input.promptVersion,
      input.schemaVersion,
      TAXONOMY_VERSION,
      ALGORITHM_VERSION,
      input.inputHash,
      input.outputHash ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.latencyMs,
      input.status,
      input.errorCode ?? null,
      nowIso(),
    ),
  );
}

export async function replaceEntryAnalysis(
  env: Env,
  input: {
    userId: string;
    entryId: string;
    revision: EntryRevisionRow;
    modelRunId: string;
    assertions: Array<{
      id: string;
      traitId: string;
      level: number | null;
      observation: "stated" | "inferred";
      confidence: number;
      evidenceField: string;
      evidenceQuote: string;
      evidenceStart: number;
      evidenceEnd: number;
    }>;
    preferences: Array<{
      id: string;
      traitId: string;
      polarity: "positive" | "negative";
      strength: number;
      evidenceQuote: string;
    }>;
    freeTags: Array<{ id: string; label: string; evidenceQuote: string }>;
  },
): Promise<void> {
  const now = nowIso();
  const correctionRows = await all<{
    id: string;
    trait_id: string;
    action: "confirm" | "reject" | "replace";
    replacement_trait_id: string | null;
    level: number | null;
    note: string | null;
    created_at: string;
  }>(
    env.DB.prepare(`
    SELECT id, trait_id, action, replacement_trait_id, level, note, created_at
    FROM corrections WHERE user_id = ? AND entry_id = ? ORDER BY created_at, id
  `).bind(input.userId, input.entryId),
  );
  const latestCorrections = new Map<string, (typeof correctionRows)[number]>();
  correctionRows.forEach((correction) => {
    latestCorrections.set(correction.trait_id, correction);
  });
  type PersistedAssertion = (typeof input.assertions)[number] & {
    source: "llm" | "manual";
    modelRunId: string | null;
  };
  const persistedAssertions: PersistedAssertion[] = input.assertions.map((assertion) => ({
    ...assertion,
    source: "llm",
    modelRunId: input.modelRunId,
  }));
  for (const correction of [...latestCorrections.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )) {
    for (let index = persistedAssertions.length - 1; index >= 0; index -= 1) {
      if (persistedAssertions[index].traitId === correction.trait_id) persistedAssertions.splice(index, 1);
    }
    if (correction.action === "reject") continue;
    const traitId = correction.action === "replace" ? correction.replacement_trait_id : correction.trait_id;
    if (!traitId) continue;
    for (let index = persistedAssertions.length - 1; index >= 0; index -= 1) {
      if (persistedAssertions[index].traitId === traitId) persistedAssertions.splice(index, 1);
    }
    persistedAssertions.push({
      id: crypto.randomUUID(),
      traitId,
      level: correction.level,
      observation: "stated",
      confidence: 1,
      evidenceField: "correction",
      evidenceQuote: correction.note || `ユーザー訂正 (${correction.action})`,
      evidenceStart: 0,
      evidenceEnd: 0,
      source: "manual",
      modelRunId: null,
    });
  }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE trait_assertions SET active = 0 WHERE user_id = ? AND entry_id = ?").bind(
      input.userId,
      input.entryId,
    ),
    env.DB.prepare(
      "UPDATE preference_signals SET active = 0 WHERE user_id = ? AND entry_id = ? AND source_type = 'entry'",
    ).bind(input.userId, input.entryId),
    env.DB.prepare("DELETE FROM free_tags WHERE entry_revision_id = ?").bind(input.revision.id),
    ...persistedAssertions.map((assertion) =>
      env.DB.prepare(`
      INSERT INTO trait_assertions (
        id, user_id, entry_id, entry_revision_id, model_run_id, trait_id, level,
        observation, confidence, evidence_field, evidence_quote, evidence_start,
        evidence_end, source, active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
        assertion.id,
        input.userId,
        input.entryId,
        input.revision.id,
        assertion.modelRunId,
        assertion.traitId,
        assertion.level,
        assertion.observation,
        assertion.confidence,
        assertion.evidenceField,
        assertion.evidenceQuote,
        assertion.evidenceStart,
        assertion.evidenceEnd,
        assertion.source,
        now,
      ),
    ),
    ...input.preferences.map((preference) =>
      env.DB.prepare(`
      INSERT INTO preference_signals (
        id, user_id, source_type, source_id, entry_id, trait_id, polarity,
        strength, evidence_quote, active, created_at
      ) VALUES (?, ?, 'entry', ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
        preference.id,
        input.userId,
        input.revision.id,
        input.entryId,
        preference.traitId,
        preference.polarity,
        preference.strength,
        preference.evidenceQuote,
        now,
      ),
    ),
    ...input.freeTags.map((tag) =>
      env.DB.prepare(`
      INSERT INTO free_tags (id, user_id, entry_revision_id, label, evidence_quote, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(tag.id, input.userId, input.revision.id, tag.label, tag.evidenceQuote, now),
    ),
  ];
  const result = await env.DB.batch(statements);
  if (result.some((item) => !item.success)) throw new Error("Could not persist entry analysis");
}

export async function saveEntryEmbedding(
  env: Env,
  input: {
    userId: string;
    revisionId: string;
    vectorId: string;
    model: string;
    vector: number[];
    contentHash: string;
    status: "pending" | "synced" | "failed";
  },
): Promise<void> {
  await run(
    env.DB.prepare(`
    INSERT INTO entry_embeddings (
      entry_revision_id, user_id, vector_id, model, dimensions, vector_json,
      content_hash, vector_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_revision_id) DO UPDATE SET
      vector_id = excluded.vector_id,
      model = excluded.model,
      dimensions = excluded.dimensions,
      vector_json = excluded.vector_json,
      content_hash = excluded.content_hash,
      vector_status = excluded.vector_status,
      updated_at = excluded.updated_at
  `).bind(
      input.revisionId,
      input.userId,
      input.vectorId,
      input.model,
      input.vector.length,
      JSON.stringify(input.vector),
      input.contentHash,
      input.status,
      nowIso(),
    ),
  );
}

type EvidenceRow = {
  id: string;
  entry_id: string;
  work_title: string | null;
  trait_id: string;
  confidence: number;
  observation: "stated" | "inferred";
  source: "llm" | "manual";
};

type SignalRow = {
  id: string;
  trait_id: string;
  polarity: "positive" | "negative";
  strength: number;
};

type EntryTraitsRow = { entry_id: string; trait_id: string; vector_json: string | null };

export async function computeTasteProfile(
  env: Env,
  userId: string,
  profileGeneration: number,
): Promise<{
  profile: TasteProfile;
  version: number;
  evidenceHash: string;
}> {
  const countRow = await first<{ count: number }>(
    env.DB.prepare("SELECT COUNT(*) AS count FROM entries WHERE user_id = ? AND status = 'active'").bind(userId),
  );
  const versionRow = await first<{ version: number | null }>(
    env.DB.prepare("SELECT MAX(version) AS version FROM profile_snapshots WHERE user_id = ?").bind(userId),
  );
  const evidenceRows = await all<EvidenceRow>(
    env.DB.prepare(`
    SELECT ta.id, ta.entry_id, er.work_title, ta.trait_id, ta.confidence, ta.observation, ta.source
    FROM trait_assertions ta
    JOIN entries e ON e.id = ta.entry_id AND e.status = 'active'
    JOIN entry_revisions er ON er.id = ta.entry_revision_id AND er.revision = e.current_revision
    WHERE ta.user_id = ? AND ta.active = 1
  `).bind(userId),
  );
  const signalRows = await all<SignalRow>(
    env.DB.prepare(`
    SELECT id, trait_id, polarity, strength
    FROM preference_signals
    WHERE user_id = ? AND active = 1
  `).bind(userId),
  );
  const entryTraitRows = await all<EntryTraitsRow>(
    env.DB.prepare(`
    SELECT e.id AS entry_id, ta.trait_id, ee.vector_json
    FROM entries e
    LEFT JOIN trait_assertions ta ON ta.entry_id = e.id AND ta.active = 1
    LEFT JOIN entry_revisions er ON er.entry_id = e.id AND er.revision = e.current_revision
    LEFT JOIN entry_embeddings ee ON ee.entry_revision_id = er.id
    WHERE e.user_id = ? AND e.status = 'active'
  `).bind(userId),
  );

  const evidence: ProfileEvidence[] = evidenceRows.map((row) => ({
    id: row.id,
    entryId: row.entry_id,
    workKey: row.work_title,
    traitId: row.trait_id,
    confidence: row.confidence,
    observation: row.observation,
    source: row.source,
  }));
  const signals: ProfileSignal[] = signalRows.map((row) => ({
    id: row.id,
    traitId: row.trait_id,
    polarity: row.polarity,
    strength: row.strength,
  }));
  const vectorMap = new Map<string, EntryVector>();
  entryTraitRows.forEach((row) => {
    const existing = vectorMap.get(row.entry_id) ?? {
      entryId: row.entry_id,
      traitIds: [],
      embedding: row.vector_json ? (JSON.parse(row.vector_json) as number[]) : undefined,
    };
    if (row.trait_id && !existing.traitIds.includes(row.trait_id)) existing.traitIds.push(row.trait_id);
    vectorMap.set(row.entry_id, existing);
  });
  const version = (versionRow?.version ?? 0) + 1;
  const evidenceHash = await sha256Hex(
    JSON.stringify({
      evidence: evidence.map((item) => item.id).sort(),
      signals: signals.map((item) => item.id).sort(),
      profileGeneration,
    }),
  );
  return {
    profile: buildTasteProfile({
      profileVersion: version,
      entryCount: countRow?.count ?? 0,
      evidence,
      signals,
      entries: [...vectorMap.values()],
    }),
    version,
    evidenceHash,
  };
}

export async function commitProfileSnapshot(
  env: Env,
  input: {
    userId: string;
    profileGeneration: number;
    version: number;
    evidenceHash: string;
    profile: TasteProfile;
  },
): Promise<{ id: string; committed: boolean }> {
  const snapshotId = crypto.randomUUID();
  const now = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO profile_snapshots (
        id, user_id, version, profile_generation, evidence_set_hash,
        taxonomy_version, algorithm_version, profile_json, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM users WHERE id = ? AND status = 'active' AND profile_generation = ?
    `).bind(
      snapshotId,
      input.userId,
      input.version,
      input.profileGeneration,
      input.evidenceHash,
      TAXONOMY_VERSION,
      ALGORITHM_VERSION,
      JSON.stringify(input.profile),
      now,
      input.userId,
      input.profileGeneration,
    ),
    env.DB.prepare(`
      UPDATE users SET current_profile_snapshot_id = ?
      WHERE id = ? AND status = 'active' AND profile_generation = ?
        AND EXISTS (SELECT 1 FROM profile_snapshots WHERE id = ?)
    `).bind(snapshotId, input.userId, input.profileGeneration, snapshotId),
  ]);
  const committed = Number(results[0]?.meta?.changes ?? 0) === 1 && Number(results[1]?.meta?.changes ?? 0) === 1;
  if (!committed) {
    await run(env.DB.prepare("DELETE FROM profile_snapshots WHERE id = ?").bind(snapshotId));
  }
  return { id: snapshotId, committed };
}

export async function loadCurrentProfile(
  env: Env,
  userId: string,
): Promise<{ id: string; profile: TasteProfile } | null> {
  const row = await first<ProfileSnapshotRow>(
    env.DB.prepare(`
    SELECT ps.*
    FROM users u
    JOIN profile_snapshots ps ON ps.id = u.current_profile_snapshot_id
    WHERE u.id = ? AND u.status = 'active'
  `).bind(userId),
  );
  return row ? { id: row.id, profile: JSON.parse(row.profile_json) as TasteProfile } : null;
}
