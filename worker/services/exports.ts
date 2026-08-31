import { deriveUuid, nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env, ExportWorkflowParams } from "../types";
import { claimJob, finishJobAttempt, type JobClaim } from "./jobs";
import { outboxStatement } from "./orchestration";
import { prepareQuotaReservation } from "./quota";

export async function createAccountExport(env: Env, ownerUserId: string, idempotencyKey: string) {
  if (!env.EXPORTS) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
  const exportId = await deriveUuid(env.AUTH_PEPPER, `account-export:${ownerUserId}:${idempotencyKey}`);
  const existing = await first<{ id: string; job_id: string; status: string }>(
    env.DB.prepare(`SELECT id,job_id,status FROM account_exports WHERE id=? AND owner_user_id=?`).bind(
      exportId,
      ownerUserId,
    ),
  );
  if (existing) return { exportId: existing.id, jobId: existing.job_id, status: existing.status, replayed: true };
  const jobId = crypto.randomUUID();
  const now = nowIso();
  const requestHash = await sha256Hex("{}");
  const quota = await prepareQuotaReservation(env, ownerUserId, "export", idempotencyKey, requestHash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    {
      type: "export.start",
      params: { jobId, ownerUserId, exportId },
    },
    `export:${exportId}`,
    idempotencyKey,
  );
  const results = await env.DB.batch([
    ...quota.statements,
    env.DB.prepare(
      `INSERT INTO jobs
        (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,
         current_step,retryable,revision,quota_reservation_id,created_at,updated_at)
       VALUES (?,?,'export','queued','account_export',?,1,0,2,'collect',1,1,?,?,?)`,
    ).bind(jobId, ownerUserId, exportId, quota.id, now, now),
    env.DB.prepare(
      `INSERT INTO account_exports (id,owner_user_id,job_id,status,schema_version,created_at,updated_at)
       VALUES (?,?,?,'queued','4.0',?,?)`,
    ).bind(exportId, ownerUserId, jobId, now, now),
    outbox.statement,
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1_EXPORT_CREATE_FAILED");
  return { exportId, jobId, outboxEventId: outbox.id, status: "queued", replayed: false };
}

async function rows(env: Env, sql: string, ownerUserId: string) {
  return all<Record<string, unknown>>(env.DB.prepare(sql).bind(ownerUserId));
}

async function collectAccountData(env: Env, ownerUserId: string) {
  const [
    user,
    entries,
    revisions,
    works,
    identities,
    representations,
    sources,
    sourceSets,
    sourceSetItems,
    understandingRuns,
    understandingSnapshots,
    characterAssertions,
    customizationDeltas,
    understandingReviews,
    analysisRuns,
    preferenceAssertions,
    valueStances,
    evidence,
    profiles,
    profileDimensions,
    profileSnapshots,
    profileSnapshotItems,
    graphSnapshots,
    graphNodes,
    graphEdges,
    generationRequests,
    generationPreferences,
    generationBriefs,
    generatedCharacters,
    generationBasisLinks,
    generationValidations,
    modelRuns,
    jobs,
    jobAttempts,
    darkScopeAssessments,
    darkBaselineSnapshots,
    darkTransformationDeltas,
  ] = await Promise.all([
    rows(
      env,
      `SELECT id,username,status,is_public,activated_at,created_at,updated_at FROM users WHERE id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM user_character_entries WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT er.* FROM entry_revisions er JOIN user_character_entries e ON e.id=er.entry_id WHERE e.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM works WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM character_identities WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM character_representations WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM sources WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM source_sets WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT i.* FROM source_set_items i JOIN source_sets s ON s.id=i.source_set_id WHERE s.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM character_understanding_runs WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM character_understanding_snapshots WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM character_assertions WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM customization_deltas WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM understanding_reviews WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM analysis_runs WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM preference_assertions WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM value_stance_assertions WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM evidence_fragments WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM profile_projections WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT d.* FROM profile_dimensions d JOIN profile_projections p ON p.id=d.profile_projection_id WHERE p.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM profile_snapshots WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT i.* FROM profile_snapshot_items i JOIN profile_snapshots s ON s.id=i.profile_snapshot_id WHERE s.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM graph_projection_snapshots WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT n.* FROM graph_projection_nodes n JOIN graph_projection_snapshots s ON s.id=n.projection_snapshot_id WHERE s.owner_user_id=?`,
      ownerUserId,
    ),
    rows(
      env,
      `SELECT e.* FROM graph_projection_edges e JOIN graph_projection_snapshots s ON s.id=e.projection_snapshot_id WHERE s.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM generation_requests WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT p.* FROM generation_request_preferences p JOIN generation_requests r ON r.id=p.generation_request_id WHERE r.owner_user_id=?`,
      ownerUserId,
    ),
    rows(
      env,
      `SELECT b.* FROM generation_briefs b JOIN generation_requests r ON r.id=b.generation_request_id WHERE r.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM generated_characters WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT l.* FROM generation_basis_links l JOIN generated_characters c ON c.id=l.generated_character_id WHERE c.owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT * FROM generation_validation_runs WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM model_run_metadata WHERE owner_user_id=?`, ownerUserId),
    rows(
      env,
      `SELECT id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,error_code,error_detail_safe,result_ref_json,workflow_instance_id,revision,created_at,updated_at,completed_at FROM jobs WHERE owner_user_id=?`,
      ownerUserId,
    ),
    rows(env, `SELECT a.* FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM dark_scope_assessments WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM dark_baseline_snapshots WHERE owner_user_id=?`, ownerUserId),
    rows(env, `SELECT * FROM dark_transformation_deltas WHERE owner_user_id=?`, ownerUserId),
  ]);
  const domainPartition = (analysisDomain: "standard" | "dark") => ({
    entries: entries.filter((row) => row.analysis_domain === analysisDomain),
    works: works.filter((row) => row.analysis_domain === analysisDomain),
    identities: identities.filter((row) => row.analysis_domain === analysisDomain),
    preferenceAssertions: preferenceAssertions.filter((row) => row.analysis_domain === analysisDomain),
    profileDimensions: profileDimensions.filter((row) => row.analysis_domain === analysisDomain),
    profileSnapshotItems: profileSnapshotItems.filter((row) => row.analysis_domain === analysisDomain),
    graphNodes: graphNodes.filter((row) => row.analysis_domain === analysisDomain),
    graphEdges: graphEdges.filter((row) => row.analysis_domain === analysisDomain),
    generationRequests: generationRequests.filter((row) => row.analysis_domain === analysisDomain),
    modelRuns: modelRuns.filter((row) => row.analysis_domain === analysisDomain),
    jobs: jobs.filter((row) => row.analysis_domain === analysisDomain),
    ...(analysisDomain === "dark" ? { darkScopeAssessments, darkBaselineSnapshots, darkTransformationDeltas } : {}),
  });
  return {
    schemaVersion: "4.0",
    exportedAt: nowIso(),
    user: user[0] ?? null,
    domains: {
      standard: domainPartition("standard"),
      dark: domainPartition("dark"),
    },
    entries: { entries, revisions, works, identities, representations },
    sources: { sources, sets: sourceSets, setItems: sourceSetItems },
    understanding: {
      runs: understandingRuns,
      snapshots: understandingSnapshots,
      assertions: characterAssertions,
      customizationDeltas,
      reviews: understandingReviews,
      darkScopeAssessments,
      darkBaselineSnapshots,
      darkTransformationDeltas,
    },
    preferenceAnalysis: { runs: analysisRuns, assertions: preferenceAssertions, valueStances, evidence },
    profile: {
      projections: profiles,
      dimensions: profileDimensions,
      snapshots: profileSnapshots,
      snapshotItems: profileSnapshotItems,
    },
    graph: { snapshots: graphSnapshots, nodes: graphNodes, edges: graphEdges },
    generation: {
      requests: generationRequests,
      preferences: generationPreferences,
      briefs: generationBriefs,
      characters: generatedCharacters,
      basisLinks: generationBasisLinks,
      validations: generationValidations,
    },
    operations: { modelRuns, jobs, jobAttempts },
  };
}

export async function processAccountExport(env: Env, params: ExportWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  let storedObjectKey: string | undefined;
  try {
    if (!env.EXPORTS) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
    claim = await claimJob(env, params.jobId, params.ownerUserId, 1, "account-export");
    if (claim.status === "attempts_exhausted") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    if (claim.status !== "claimed") return;
    const started = nowIso();
    await env.DB.prepare(
      `UPDATE account_exports SET status='running',updated_at=? WHERE id=? AND owner_user_id=? AND status IN ('queued','failed')`,
    )
      .bind(started, params.exportId, params.ownerUserId)
      .run();
    const payload = JSON.stringify(await collectAccountData(env, params.ownerUserId));
    const bytes = new TextEncoder().encode(payload);
    const objectKey = `account-exports/${params.exportId}.json`;
    storedObjectKey = objectKey;
    await env.EXPORTS.put(objectKey, bytes, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        contentDisposition: `attachment; filename="account-export-${params.exportId}.json"`,
      },
      customMetadata: { ownerUserId: params.ownerUserId, exportId: params.exportId },
    });
    const completed = nowIso();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const committed = await env.DB.batch([
      env.DB.prepare(
        `UPDATE jobs SET status='succeeded',current_step='complete',progress_current=2,result_ref_json=?,
         updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND status='running'`,
      ).bind(JSON.stringify({ exportId: params.exportId }), completed, completed, params.jobId, params.ownerUserId),
      env.DB.prepare(
        `UPDATE account_exports SET status='ready',object_key=?,content_hash=?,byte_size=?,updated_at=?,completed_at=?,expires_at=?
         WHERE id=? AND owner_user_id=?
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND owner_user_id=? AND status='succeeded')`,
      ).bind(
        objectKey,
        await sha256Hex(payload),
        bytes.byteLength,
        completed,
        completed,
        expiresAt,
        params.exportId,
        params.ownerUserId,
        params.jobId,
        params.ownerUserId,
      ),
      env.DB.prepare(
        `UPDATE job_attempts SET status='succeeded',finished_at=?,lease_expires_at=NULL
         WHERE id=? AND job_id=? AND status='running'`,
      ).bind(completed, claim.attemptId, params.jobId),
    ]);
    if (committed.some((item) => !item.success) || committed.some((item) => !item.meta.changes)) {
      await env.EXPORTS.delete(objectKey);
      storedObjectKey = undefined;
      throw new Error("EXPORT_COMMIT_FENCE_CHANGED");
    }
    storedObjectKey = undefined;
  } catch (error) {
    if (storedObjectKey && env.EXPORTS) await env.EXPORTS.delete(storedObjectKey);
    const code = error instanceof Error ? error.message.slice(0, 100) : "EXPORT_FAILED";
    const permanent = code === "EXPORT_STORAGE_UNAVAILABLE" || code === "EXPORT_COMMIT_FENCE_CHANGED";
    const willRetry = claim?.status === "claimed" && claim.stepAttemptNumber < 3 && !permanent;
    if (claim?.status === "claimed") await finishJobAttempt(env, claim.attemptId, "failed", code);
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE account_exports SET status='failed',error_code=?,updated_at=?
         WHERE id=? AND owner_user_id=? AND status!='ready'
           AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status!='succeeded')`,
      ).bind(code, now, params.exportId, params.ownerUserId, params.jobId),
      env.DB.prepare(
        `UPDATE jobs SET status=?,error_code=?,retryable=?,next_attempt_at=?,updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND status!='succeeded'`,
      ).bind(
        willRetry ? "retrying" : "failed",
        code,
        willRetry ? 1 : 0,
        willRetry ? new Date(Date.now() + 5_000).toISOString() : null,
        now,
        willRetry ? null : now,
        params.jobId,
      ),
    ]);
    if (willRetry) throw error;
  }
}

export async function expireAccountExports(env: Env): Promise<number> {
  if (!env.EXPORTS) return 0;
  const expired = await all<{ id: string; object_key: string | null }>(
    env.DB.prepare(`SELECT id,object_key FROM account_exports WHERE status='ready' AND expires_at<=? LIMIT 100`).bind(
      nowIso(),
    ),
  );
  for (const item of expired) if (item.object_key) await env.EXPORTS.delete(item.object_key);
  if (expired.length)
    await env.DB.prepare(
      `UPDATE account_exports SET status='expired',object_key=NULL,updated_at=? WHERE status='ready' AND expires_at<=?`,
    )
      .bind(nowIso(), nowIso())
      .run();
  const metadataCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  await env.DB.prepare(`DELETE FROM account_exports WHERE status='expired' AND created_at<?`)
    .bind(metadataCutoff)
    .run();
  return expired.length;
}
