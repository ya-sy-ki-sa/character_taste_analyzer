import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { EntryDraft } from "../shared/schemas";
import { entryBaseCharacterName, entryInputSources, entryScopeText } from "../shared/schemas";
import { processCharacterAnalysis } from "../worker/services/analysis";
import type { Env } from "../worker/types";

const databasePath = process.env.LOCAL_D1_PATH;
if (!databasePath) throw new Error("LOCAL_D1_PATH is required");
const database = new DatabaseSync(resolve(databasePath));
database.exec("PRAGMA foreign_keys=ON");

class LocalStatement {
  constructor(
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new LocalStatement(this.sql, values);
  }
  async first<T>(column?: string): Promise<T | null> {
    const row = database.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T>() {
    return { results: database.prepare(this.sql).all(...this.values) as T[], success: true, meta: {} };
  }
  async run() {
    const result = database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

const d1 = {
  prepare(sql: string) {
    return new LocalStatement(sql);
  },
  async batch(statements: LocalStatement[]) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
} as unknown as D1Database;

function vars(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const secrets = vars(".dev.vars");
const env = {
  DB: d1,
  ENVIRONMENT: "local",
  DEPLOYMENT_PROFILE: "free_validation",
  DATASTORE_STRATEGY: "d1",
  AUTH_PEPPER: secrets.AUTH_PEPPER,
  LLM_PROVIDER: "openai",
  LLM_MODEL: "gpt-5.6-luna",
  LLM_FALLBACK_PROVIDER: "",
  LLM_FALLBACK_MODEL: "",
  OPENAI_API_KEY: secrets.OPENAI_API_KEY,
  OPENAI_TRANSPORT: "direct",
  EMBEDDING_PROVIDER: "openai",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: "1536",
  ANALYSIS_DAILY_QUOTA: "1000",
  GENERATION_DAILY_QUOTA: "1000",
  EXPORT_DAILY_QUOTA: "1000",
  SESSION_DAYS: "30",
  SESSION_RENEWAL_DAYS: "7",
} as Env;
if (!env.AUTH_PEPPER || !env.OPENAI_API_KEY) throw new Error(".dev.vars requires AUTH_PEPPER and OPENAI_API_KEY");

type EntryRow = {
  id: string;
  owner_user_id: string;
  active_revision_number: number;
  representation_id: string;
  character_identity_id: string;
  work_id: string | null;
  registration_payload_json: string;
  analysis_contract_version: string;
};

function insertSourceSet(ownerUserId: string, title: string, draft: EntryDraft): string {
  const sourceSetId = randomUUID();
  const sourceSetVersionId = randomUUID();
  const sources = entryInputSources(draft);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO source_sets (id,owner_user_id,purpose,active_version,created_at,updated_at) VALUES (?,?,'character_understanding',1,?,?)`,
    )
    .run(sourceSetId, ownerUserId, now, now);
  database
    .prepare(`INSERT INTO source_set_versions (id,source_set_id,version,content_hash,created_at) VALUES (?,?,1,?,?)`)
    .run(
      sourceSetVersionId,
      sourceSetId,
      hash(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text })))),
      now,
    );
  for (const [ordinal, source] of sources.entries()) {
    const documentId = randomUUID();
    const sourceRevisionId = randomUUID();
    const sourceHash = hash(source.text);
    database
      .prepare(
        `INSERT INTO source_documents (id,owner_user_id,title,source_type,visibility,citation_json,rights_basis,active_revision_number,revision,created_at,updated_at) VALUES (?,?,?,'user_text','private',?,'user_supplied',1,1,?,?)`,
      )
      .run(
        documentId,
        ownerUserId,
        `${title} ${source.label}`,
        JSON.stringify({ inputPointer: source.pointer }),
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO source_document_revisions (id,source_document_id,revision_number,inline_text,mime_type,byte_size,content_hash,upload_status,extraction_status,finalized_at,created_at) VALUES (?,?,1,?,'text/plain',?,?,'finalized','ready',?,?)`,
      )
      .run(
        sourceRevisionId,
        documentId,
        source.text,
        new TextEncoder().encode(source.text).byteLength,
        sourceHash,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO source_fragments (id,source_document_revision_id,ordinal,locator_json,text_content,content_hash,token_estimate,created_at) VALUES (?,?,0,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        sourceRevisionId,
        JSON.stringify({ type: "json_pointer", pointer: source.pointer }),
        source.text,
        sourceHash,
        Math.ceil(source.text.length / 3),
        now,
      );
    database
      .prepare(
        `INSERT INTO source_set_items (source_set_version_id,source_document_revision_id,priority,usage_type) VALUES (?,?,?,'user_definition')`,
      )
      .run(sourceSetVersionId, sourceRevisionId, ordinal + 1);
  }
  return sourceSetVersionId;
}

const rows = database
  .prepare(`
    SELECT e.id,e.owner_user_id,e.active_revision_number,er.representation_id,cr.character_identity_id,
           ci.work_id,er.registration_payload_json,er.analysis_contract_version
    FROM user_character_entries e JOIN entry_revisions er
      ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    JOIN character_representations cr ON cr.id=er.representation_id
    JOIN character_identities ci ON ci.id=cr.character_identity_id
    WHERE e.deleted_at IS NULL ORDER BY e.created_at,e.id
  `)
  .all() as unknown as EntryRow[];

const migrated: Array<{ entryId: string; ownerUserId: string; revision: number; jobId: string }> = [];
const affectedOwners = new Set<string>();
database.exec("BEGIN IMMEDIATE");
try {
  for (const row of rows) {
    if (row.analysis_contract_version === "2") continue;
    const oldDraft = JSON.parse(row.registration_payload_json) as EntryDraft;
    const draft: EntryDraft =
      oldDraft.registrationType === "original"
        ? { ...oldDraft, schemaVersion: "2" }
        : {
            ...oldDraft,
            schemaVersion: "2",
            ...(oldDraft.registrationType === "customized_existing"
              ? { baseCharacterName: entryBaseCharacterName(oldDraft) }
              : {}),
            identityResolution: {
              mode: "reuse",
              workId: row.work_id,
              characterIdentityId: row.character_identity_id,
            },
          };
    const revision = row.active_revision_number + 1;
    const revisionId = randomUUID();
    const jobId = randomUUID();
    const sourceSetVersionId = insertSourceSet(
      row.owner_user_id,
      draft.registrationType === "original" ? draft.characterName : `${draft.workTitle} / ${draft.characterName}`,
      draft,
    );
    const payload = JSON.stringify(draft);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO entry_revisions (id,entry_id,revision_number,representation_id,source_set_version_id,known_scope,user_character_view,preference_input_json,registration_payload_json,content_hash,analysis_contract_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'2',?)`,
      )
      .run(
        revisionId,
        row.id,
        revision,
        row.representation_id,
        sourceSetVersionId,
        entryScopeText(draft),
        draft.userCharacterView ?? null,
        JSON.stringify(draft.preference),
        payload,
        hash(payload),
        now,
      );
    database
      .prepare(
        `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,created_at,updated_at) VALUES (?,?,'character_analysis','queued','entry',?,?,0,15,'queued',1,1,?,?)`,
      )
      .run(jobId, row.owner_user_id, row.id, revision, now, now);
    database
      .prepare(
        `UPDATE jobs SET status='superseded',retryable=0,updated_at=?,completed_at=?,revision=revision+1 WHERE owner_user_id=? AND target_type='entry' AND target_id=? AND id<>? AND status IN ('queued','running','waiting_for_user','retrying')`,
      )
      .run(now, now, row.owner_user_id, row.id, jobId);
    database
      .prepare(
        `UPDATE user_character_entries SET status='submitted',active_revision_number=?,draft_schema_version='2',draft_payload_json=?,draft_updated_at=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND active_revision_number=?`,
      )
      .run(revision, payload, now, now, row.id, row.owner_user_id, row.active_revision_number);
    const eventPayload = JSON.stringify({
      type: "analysis.start",
      params: {
        jobId,
        ownerUserId: row.owner_user_id,
        entryId: row.id,
        stage: "understanding",
        inputGeneration: revision,
      },
    });
    database
      .prepare(
        `INSERT INTO outbox_events (id,owner_user_id,aggregate_type,aggregate_id,aggregate_revision,event_type,event_version,payload_json,payload_hash,correlation_id,deduplication_key,status,attempt_count,available_at,created_at,published_at) VALUES (?,?,'job',?,1,'analysis.start',1,?,?,?,?,'published',1,?,?,?)`,
      )
      .run(
        randomUUID(),
        row.owner_user_id,
        jobId,
        eventPayload,
        hash(eventPayload),
        revisionId,
        `local-reanalysis:${jobId}`,
        now,
        now,
        now,
      );
    migrated.push({ entryId: row.id, ownerUserId: row.owner_user_id, revision, jobId });
    affectedOwners.add(row.owner_user_id);
  }
  for (const ownerUserId of affectedOwners) {
    const state = database
      .prepare(`SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`)
      .get(ownerUserId) as { desired_generation: number; built_generation: number } | undefined;
    const desired = (state?.desired_generation ?? 0) + 1;
    database
      .prepare(
        `INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at) VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at`,
      )
      .run(ownerUserId, desired, state?.built_generation ?? 0, new Date().toISOString());
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}

const startedAt = new Date().toISOString();
if (!migrated.length) {
  const resumable = database
    .prepare(`
      SELECT e.id AS entry_id,e.owner_user_id,e.active_revision_number,j.id AS job_id
      FROM user_character_entries e JOIN jobs j ON j.owner_user_id=e.owner_user_id
        AND j.target_type='entry' AND j.target_id=e.id AND j.input_generation=e.active_revision_number
      JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
      WHERE er.analysis_contract_version='2' AND e.status IN ('failed','submitted','understanding')
        AND EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate_id=j.id AND o.deduplication_key LIKE 'local-reanalysis:%')
      ORDER BY e.created_at,e.id
    `)
    .all() as Array<{ entry_id: string; owner_user_id: string; active_revision_number: number; job_id: string }>;
  for (const item of resumable)
    migrated.push({
      entryId: item.entry_id,
      ownerUserId: item.owner_user_id,
      revision: item.active_revision_number,
      jobId: item.job_id,
    });
}

for (const item of migrated) {
  let revision = database
    .prepare(`SELECT * FROM entry_revisions WHERE entry_id=? AND revision_number=?`)
    .get(item.entryId, item.revision) as {
    id: string;
    source_set_version_id: string;
    registration_payload_json: string;
    representation_id: string;
    known_scope: string;
    user_character_view: string | null;
    preference_input_json: string;
    content_hash: string;
  };
  const attemptCount = database
    .prepare(`SELECT COUNT(*) AS count FROM job_attempts WHERE job_id=?`)
    .get(item.jobId) as {
    count: number;
  };
  if (attemptCount.count >= 3) {
    const nextRevision = item.revision + 1;
    const nextRevisionId = randomUUID();
    const nextJobId = randomUUID();
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO entry_revisions (id,entry_id,revision_number,representation_id,source_set_version_id,known_scope,user_character_view,preference_input_json,registration_payload_json,content_hash,analysis_contract_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'2',?)`,
      )
      .run(
        nextRevisionId,
        item.entryId,
        nextRevision,
        revision.representation_id,
        revision.source_set_version_id,
        revision.known_scope,
        revision.user_character_view,
        revision.preference_input_json,
        revision.registration_payload_json,
        revision.content_hash,
        now,
      );
    database
      .prepare(
        `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,created_at,updated_at) VALUES (?,?,'character_analysis','queued','entry',?,?,0,15,'queued',1,1,?,?)`,
      )
      .run(nextJobId, item.ownerUserId, item.entryId, nextRevision, now, now);
    database
      .prepare(
        `UPDATE user_character_entries SET status='submitted',active_revision_number=?,updated_at=?,revision=revision+1 WHERE id=?`,
      )
      .run(nextRevision, now, item.entryId);
    const eventPayload = JSON.stringify({
      type: "analysis.start",
      params: {
        jobId: nextJobId,
        ownerUserId: item.ownerUserId,
        entryId: item.entryId,
        stage: "understanding",
        inputGeneration: nextRevision,
      },
    });
    database
      .prepare(
        `INSERT INTO outbox_events (id,owner_user_id,aggregate_type,aggregate_id,aggregate_revision,event_type,event_version,payload_json,payload_hash,correlation_id,deduplication_key,status,attempt_count,available_at,created_at,published_at) VALUES (?,?,'job',?,1,'analysis.start',1,?,?,?,?,'published',1,?,?,?)`,
      )
      .run(
        randomUUID(),
        item.ownerUserId,
        nextJobId,
        eventPayload,
        hash(eventPayload),
        nextRevisionId,
        `local-reanalysis:${nextJobId}`,
        now,
        now,
        now,
      );
    item.revision = nextRevision;
    item.jobId = nextJobId;
    revision = database.prepare(`SELECT * FROM entry_revisions WHERE id=?`).get(nextRevisionId) as typeof revision;
  }
  const draft = JSON.parse(revision.registration_payload_json) as EntryDraft & { sourceText?: string };
  if (draft.registrationType === "original" && !(draft as { characterBasicInfo?: string }).characterBasicInfo) {
    const basicInfo = entryReferenceMaterial(draft) ?? draft.userCharacterView ?? `${draft.characterName}の旧登録情報`;
    const fixed = { ...draft, characterBasicInfo: basicInfo };
    const payload = JSON.stringify(fixed);
    const now = new Date().toISOString();
    database
      .prepare(`UPDATE entry_revisions SET registration_payload_json=?,content_hash=? WHERE id=?`)
      .run(payload, hash(payload), revision.id);
    database
      .prepare(`UPDATE user_character_entries SET draft_payload_json=?,draft_updated_at=?,updated_at=? WHERE id=?`)
      .run(payload, now, now, item.entryId);
    const documentId = randomUUID();
    const sourceRevisionId = randomUUID();
    const sourceHash = hash(basicInfo);
    database
      .prepare(
        `INSERT INTO source_documents (id,owner_user_id,title,source_type,visibility,citation_json,rights_basis,active_revision_number,revision,created_at,updated_at) VALUES (?,?,?,'user_text','private',?,'user_supplied',1,1,?,?)`,
      )
      .run(
        documentId,
        item.ownerUserId,
        `${fixed.characterName} キャラクター基本情報`,
        JSON.stringify({ inputPointer: "/characterBasicInfo" }),
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO source_document_revisions (id,source_document_id,revision_number,inline_text,mime_type,byte_size,content_hash,upload_status,extraction_status,finalized_at,created_at) VALUES (?,?,1,?,'text/plain',?,?,'finalized','ready',?,?)`,
      )
      .run(
        sourceRevisionId,
        documentId,
        basicInfo,
        new TextEncoder().encode(basicInfo).byteLength,
        sourceHash,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO source_fragments (id,source_document_revision_id,ordinal,locator_json,text_content,content_hash,token_estimate,created_at) VALUES (?,?,0,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        sourceRevisionId,
        JSON.stringify({ type: "json_pointer", pointer: "/characterBasicInfo" }),
        basicInfo,
        sourceHash,
        Math.ceil(basicInfo.length / 3),
        now,
      );
    database
      .prepare(
        `INSERT INTO source_set_items (source_set_version_id,source_document_revision_id,priority,usage_type) VALUES (?,?,0,'user_definition')`,
      )
      .run(revision.source_set_version_id, sourceRevisionId);
  }
  database
    .prepare(
      `UPDATE jobs SET status='queued',retryable=1,error_code=NULL,error_detail_safe=NULL,completed_at=NULL,next_attempt_at=NULL,updated_at=? WHERE id=? AND status='failed'`,
    )
    .run(new Date().toISOString(), item.jobId);
  database
    .prepare(`UPDATE user_character_entries SET status='submitted',updated_at=? WHERE id=? AND status='failed'`)
    .run(new Date().toISOString(), item.entryId);
}

for (const [index, item] of migrated.entries()) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await processCharacterAnalysis(env, {
        jobId: item.jobId,
        ownerUserId: item.ownerUserId,
        entryId: item.entryId,
        stage: "understanding",
        inputGeneration: item.revision,
      });
    } catch {
      // Retryable errors are rethrown by the workflow service and retried here serially.
    }
    const current = database.prepare(`SELECT status FROM user_character_entries WHERE id=?`).get(item.entryId) as {
      status: string;
    };
    if (current.status !== "understanding" && current.status !== "submitted") break;
  }
  const status = database.prepare(`SELECT status FROM user_character_entries WHERE id=?`).get(item.entryId) as {
    status: string;
  };
  console.log(`[${index + 1}/${migrated.length}] ${item.entryId.slice(0, 8)} ${status.status}`);
}

const summary = database
  .prepare(`
  SELECT
    SUM(CASE WHEN status='understanding_review' THEN 1 ELSE 0 END) AS succeeded,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
  FROM user_character_entries WHERE id IN (${migrated.map(() => "?").join(",")})
`)
  .get(...migrated.map((item) => item.entryId)) as { succeeded: number; failed: number };
const attempts = database
  .prepare(`
  SELECT COUNT(*) AS attempts,COALESCE(SUM(CASE WHEN attempt_number>1 THEN 1 ELSE 0 END),0) AS retries
  FROM job_attempts WHERE job_id IN (${migrated.map(() => "?").join(",")})
`)
  .get(...migrated.map((item) => item.jobId)) as { attempts: number; retries: number };
const usage = database
  .prepare(`
  SELECT COALESCE(SUM(input_token_estimate),0) AS input_tokens,
         COALESCE(SUM(output_token_estimate),0) AS output_tokens,COUNT(*) AS model_attempts
  FROM model_run_metadata WHERE created_at>=?
`)
  .get(startedAt) as { input_tokens: number; output_tokens: number; model_attempts: number };
const legacy = database
  .prepare(`SELECT COUNT(*) AS count FROM evidence_fragments WHERE verification_status='legacy_unverified'`)
  .get() as { count: number };
const freshness = database
  .prepare(`SELECT status,COUNT(*) AS count FROM projection_rebuild_states GROUP BY status ORDER BY status`)
  .all();
const report = {
  schemaVersion: "1.0",
  startedAt,
  completedAt: new Date().toISOString(),
  targetEntries: migrated.length,
  understandingReview: Number(summary.succeeded ?? 0),
  failed: Number(summary.failed ?? 0),
  jobAttempts: Number(attempts.attempts ?? 0),
  retries: Number(attempts.retries ?? 0),
  modelAttempts: Number(usage.model_attempts ?? 0),
  inputTokens: Number(usage.input_tokens ?? 0),
  outputTokens: Number(usage.output_tokens ?? 0),
  legacyEvidence: Number(legacy.count ?? 0),
  profileFreshness: freshness,
  autoConfirmed: false,
};
writeFileSync("docs/実装アルファ/07_ローカル移行結果.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
database.close();
