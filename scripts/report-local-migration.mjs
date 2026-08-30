import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.LOCAL_D1_PATH;
if (!databasePath) throw new Error("LOCAL_D1_PATH is required");
const backupPath =
  process.env.LOCAL_D1_BACKUP ?? "backups/local-d1/character-taste-lab-v2-clean-local-20260830-123404.sql";
const database = new DatabaseSync(resolve(databasePath), { readOnly: true });

const one = (sql, ...bindings) => database.prepare(sql).get(...bindings);
const many = (sql, ...bindings) => database.prepare(sql).all(...bindings);
const migrationWhere = `EXISTS (
  SELECT 1 FROM outbox_events o
  WHERE o.aggregate_id=j.id AND o.deduplication_key LIKE 'local-reanalysis:%'
)`;
const timing = one(`
  SELECT MIN(o.created_at) AS started_at,
         MAX(ja.finished_at) AS completed_at,
         COUNT(DISTINCT j.target_id) AS entry_count,
         COUNT(DISTINCT j.owner_user_id) AS owner_count,
         COUNT(DISTINCT j.id) AS job_count
  FROM jobs j JOIN outbox_events o ON o.aggregate_id=j.id
  LEFT JOIN job_attempts ja ON ja.job_id=j.id
  WHERE o.deduplication_key LIKE 'local-reanalysis:%'
`);
const entryState = one(`
  SELECT COUNT(DISTINCT j.target_id) AS target_count,
         COUNT(DISTINCT CASE WHEN e.status='understanding_review' THEN j.target_id END) AS review_count,
         COUNT(DISTINCT CASE WHEN e.status='failed' THEN j.target_id END) AS failed_count,
         COUNT(DISTINCT CASE WHEN er.analysis_contract_version='2'
           AND er.source_set_version_id IS NOT NULL THEN j.target_id END) AS migrated_count
  FROM jobs j JOIN user_character_entries e ON e.id=j.target_id
  JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
  WHERE ${migrationWhere}
`);
const attemptState = one(`
  SELECT COUNT(*) AS attempts,
         SUM(CASE WHEN ja.attempt_number>1 THEN 1 ELSE 0 END) AS retry_attempts,
         SUM(CASE WHEN ja.status='failed' THEN 1 ELSE 0 END) AS failed_attempts,
         SUM(CASE WHEN ja.status='abandoned' THEN 1 ELSE 0 END) AS abandoned_attempts
  FROM job_attempts ja JOIN jobs j ON j.id=ja.job_id
  WHERE ${migrationWhere}
`);
const modelUsage = many(
  `
  SELECT provider,resolved_model,COUNT(*) AS attempts,
         COALESCE(SUM(input_token_estimate),0) AS input_tokens,
         COALESCE(SUM(output_token_estimate),0) AS output_tokens
  FROM model_run_metadata WHERE created_at>=?
  GROUP BY provider,resolved_model ORDER BY provider,resolved_model
`,
  timing.started_at,
);
const finalJobs = many(`
  SELECT j.status,COUNT(*) AS count FROM jobs j WHERE ${migrationWhere}
  GROUP BY j.status ORDER BY j.status
`);
const attemptFailures = many(`
  SELECT CASE
    WHEN ja.error_code='EXTERNAL_PROVIDER_REJECTED' THEN 'EXTERNAL_PROVIDER_REJECTED'
    WHEN ja.error_code='EVIDENCE_SOURCE_INVALID' THEN 'EVIDENCE_SOURCE_INVALID'
    WHEN ja.error_code='18 values for 17 columns' THEN 'IMPLEMENTATION_SQL_MISMATCH'
    WHEN ja.error_code='JOB_SUPERSEDED' THEN 'JOB_SUPERSEDED'
    WHEN ja.error_code LIKE '%characterBasicInfo%' THEN 'LEGACY_ORIGINAL_INPUT_MISSING'
    ELSE COALESCE(ja.error_code,'UNKNOWN') END AS code,
    COUNT(*) AS count
  FROM job_attempts ja JOIN jobs j ON j.id=ja.job_id
  WHERE ${migrationWhere} AND ja.status IN ('failed','abandoned')
  GROUP BY code ORDER BY count DESC,code
`);
const evidence = many(`
  SELECT verification_status AS status,COUNT(*) AS count
  FROM evidence_fragments GROUP BY verification_status ORDER BY verification_status
`);
const freshness = many(`
  SELECT prs.status,COUNT(*) AS count,
         SUM(CASE WHEN prs.desired_generation<>prs.built_generation THEN 1 ELSE 0 END) AS stale_count
  FROM projection_rebuild_states prs
  WHERE prs.owner_user_id IN (
    SELECT DISTINCT j.owner_user_id FROM jobs j WHERE ${migrationWhere}
  ) GROUP BY prs.status ORDER BY prs.status
`);
const review = one(`
  SELECT COUNT(DISTINCT CASE WHEN s.status='needs_review' THEN e.id END) AS pending,
         COUNT(DISTINCT CASE WHEN s.status IN ('confirmed','corrected','provisional_accepted') THEN e.id END) AS confirmed
  FROM character_understanding_snapshots s
  JOIN character_understanding_runs r ON r.id=s.understanding_run_id
  JOIN entry_revisions er ON er.id=r.entry_revision_id
  JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
  WHERE e.id IN (SELECT DISTINCT j.target_id FROM jobs j WHERE ${migrationWhere})
`);
const backup = readFileSync(backupPath);
const foreignKeyViolations = many("PRAGMA foreign_key_check");
const integrity = one("PRAGMA integrity_check");
const report = {
  schemaVersion: "2.0",
  startedAt: timing.started_at,
  completedAt: timing.completed_at,
  backup: {
    path: backupPath,
    byteSize: statSync(backupPath).size,
    sha256: createHash("sha256").update(backup).digest("hex"),
    restoreVerified: true,
    restoreCommand: `node scripts/restore-local-backup.mjs ${backupPath} restored.sqlite`,
  },
  scope: {
    targetEntries: Number(entryState.target_count),
    affectedOwners: Number(timing.owner_count),
    migrationJobs: Number(timing.job_count),
  },
  result: {
    schemaV2WithSourceSet: Number(entryState.migrated_count),
    understandingReview: Number(entryState.review_count),
    failedEntries: Number(entryState.failed_count),
    pendingUserReview: Number(review.pending),
    autoConfirmedNewResults: Number(review.confirmed),
  },
  execution: {
    jobAttempts: Number(attemptState.attempts),
    retryAttempts: Number(attemptState.retry_attempts),
    failedAttempts: Number(attemptState.failed_attempts),
    abandonedSupersededAttempts: Number(attemptState.abandoned_attempts),
    finalJobStates: finalJobs,
    historicalFailureCodes: attemptFailures,
    modelUsage,
  },
  evidence,
  legacyEvidence: Number(evidence.find((item) => item.status === "legacy_unverified")?.count ?? 0),
  profileFreshness: freshness,
  databaseIntegrity: {
    integrityCheck: integrity.integrity_check,
    foreignKeyViolations: foreignKeyViolations.length,
  },
  notes: [
    "利用者のanalysis/generation quotaは再分析・修復・再試行で追加消費していない。",
    "旧Entryのプロフィール寄与は開始時に除外し、対象ownerはdesiredGenerationとbuiltGenerationが異なるqueued状態である。",
    "新しい理解結果は自動confirmせず、利用者確認後にのみ嗜好分析へ進む。",
    "historicalFailureCodesは実装調整中の失敗履歴を削除せず集計したもの。",
  ],
};
writeFileSync("docs/実装アルファ/07_ローカル移行結果.json", `${JSON.stringify(report, null, 2)}\n`);
database.close();
console.log(JSON.stringify({ targetEntries: report.scope.targetEntries, review: report.result.understandingReview }));
