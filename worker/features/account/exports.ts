import { accountExportDocumentSchema } from "../../../shared/contracts/account-response";
import { deriveUuid, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import { prepareQuotaReservation } from "../../platform/quota/reservations";
import type { Env, ExportWorkflowParams } from "../../types";
import { claimJob, finishJobAttempt, type JobClaim } from "../jobs/execution";
import * as repository from "./repositories/exports";

export async function createAccountExport(env: Env, ownerUserId: string, idempotencyKey: string) {
  if (!env.EXPORTS) throw new Error("EXPORT_STORAGE_UNAVAILABLE");
  const exportId = await deriveUuid(env.AUTH_PEPPER, `account-export:${ownerUserId}:${idempotencyKey}`);
  const existing = await first<{ id: string; job_id: string; status: string }>(
    repository.selectAccountExports(env.DB, [exportId, ownerUserId]),
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
    repository.insertJobs(env.DB, [jobId, ownerUserId, exportId, quota.id, now, now]),
    repository.insertAccountExports(env.DB, [exportId, ownerUserId, jobId, now, now]),
    outbox.statement,
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1_EXPORT_CREATE_FAILED");
  return { exportId, jobId, outboxEventId: outbox.id, status: "queued", replayed: false };
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
    qualityCandidates,
    generationFeedback,
    preferenceRefinements,
    similarityDocuments,
  ] = await Promise.all([
    all<Record<string, unknown>>(repository.selectExportUser(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportEntries(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportRevisions(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportWorks(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportIdentities(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportRepresentations(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportSources(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportSourceSets(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportSourceSetItems(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportUnderstandingRuns(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportUnderstandingSnapshots(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportCharacterAssertions(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportCustomizationDeltas(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportUnderstandingReviews(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportAnalysisRuns(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportPreferenceAssertions(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportValueStances(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportEvidence(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportProfiles(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportProfileDimensions(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportProfileSnapshots(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportProfileSnapshotItems(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGraphSnapshots(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGraphNodes(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGraphEdges(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationRequests(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationPreferences(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationBriefs(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGeneratedCharacters(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationBasisLinks(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationValidations(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportModelRuns(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportJobs(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportJobAttempts(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportDarkScopeAssessments(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportDarkBaselineSnapshots(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportDarkTransformationDeltas(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportQualityCandidates(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportGenerationFeedback(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportPreferenceRefinements(env.DB, ownerUserId)),
    all<Record<string, unknown>>(repository.selectExportSimilarityDocuments(env.DB, ownerUserId)),
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
    quality: {
      schemaVersion: "2.0",
      candidates: qualityCandidates,
      feedback: generationFeedback,
      refinements: preferenceRefinements,
      similarityDocuments,
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
    await repository.updateAccountExports(env.DB, [started, params.exportId, params.ownerUserId]).run();
    const payload = JSON.stringify(
      accountExportDocumentSchema.parse(await collectAccountData(env, params.ownerUserId)),
    );
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
      repository.updateJobs(env.DB, [
        JSON.stringify({ exportId: params.exportId }),
        completed,
        completed,
        params.jobId,
        params.ownerUserId,
      ]),
      repository.updateAccountExports2(env.DB, [
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
      ]),
      repository.updateJobAttempts(env.DB, [completed, claim.attemptId, params.jobId]),
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
      repository.updateAccountExports3(env.DB, [code, now, params.exportId, params.ownerUserId, params.jobId]),
      repository.updateJobs2(env.DB, [
        willRetry ? "retrying" : "failed",
        code,
        willRetry ? 1 : 0,
        willRetry ? new Date(Date.now() + 5_000).toISOString() : null,
        now,
        willRetry ? null : now,
        params.jobId,
      ]),
    ]);
    if (willRetry) throw error;
  }
}

export async function expireAccountExports(env: Env): Promise<number> {
  if (!env.EXPORTS) return 0;
  const expired = await all<{ id: string; object_key: string | null }>(
    repository.selectAccountExports2(env.DB, [nowIso()]),
  );
  for (const item of expired) if (item.object_key) await env.EXPORTS.delete(item.object_key);
  if (expired.length) await repository.updateAccountExports4(env.DB, [nowIso(), nowIso()]).run();
  const metadataCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  await repository.deleteAccountExports(env.DB, [metadataCutoff]).run();
  return expired.length;
}
