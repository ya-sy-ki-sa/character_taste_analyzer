import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { ProfileDimension, ProfileView, ProjectionFreshness } from "../../../shared/contracts/profile-response";
import { preferenceContextRecord, preferenceTargetLabel } from "../../../shared/preference-context";
import { PROFILE_ALGORITHM_VERSION } from "../../../shared/profile-algorithm";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env, ProfileRebuildWorkflowParams } from "../../types";
import { claimJob, finishJobAttempt, type JobClaim } from "../jobs/execution";
import {
  type AssertionRow,
  buildDimensions,
  buildValueStances,
  canonicalJson,
  type ValueStanceRow,
  weightAssertions,
} from "./aggregation";
import { rebuildGraphProjection } from "./graph";
import * as repository from "./repositories/projection";

const ONTOLOGY_VERSION = "standard-1.0+dark-1.0";

async function loadPreferenceAssertions(env: Env, ownerUserId: string): Promise<AssertionRow[]> {
  const assertions = await all<AssertionRow>(repository.selectPreferenceAssertions(env.DB, [ownerUserId, ownerUserId]));
  const feedback = await all<AssertionRow>(repository.selectGenerationFeedback(env.DB, [ownerUserId]));
  return [...assertions, ...feedback];
}

async function loadValueStances(env: Env, ownerUserId: string): Promise<ValueStanceRow[]> {
  return all<ValueStanceRow>(repository.selectValueStanceAssertions(env.DB, [ownerUserId, ownerUserId]));
}

export async function rebuildProfile(
  env: Env,
  ownerUserId: string,
  _cause: string,
  desiredGeneration?: number,
): Promise<{ projectionId: string; profileSnapshotId: string; graphProjectionId: string; generation: number }> {
  const [assertionRows, valueStances] = await Promise.all([
    loadPreferenceAssertions(env, ownerUserId),
    loadValueStances(env, ownerUserId),
  ]);
  const weighted = await weightAssertions(assertionRows);
  const dimensions = buildDimensions(weighted);
  const aggregatedValueStances = buildValueStances(valueStances);
  const evidenceSetHash = await sha256Hex(
    JSON.stringify({
      algorithmVersion: PROFILE_ALGORITHM_VERSION,
      ontologyVersion: ONTOLOGY_VERSION,
      assertions: assertionRows
        .map((row) => ({
          id: row.id,
          entryRevisionId: row.entry_revision_id,
          status: row.status,
          ontology: row.stable_key,
          domain: row.analysis_domain,
          polarity: row.polarity,
          responseChannel: row.response_channel,
          strength: row.strength,
          explicitness: row.explicitness,
          confidence: row.confidence,
          context: canonicalJson(row.context_json),
          evidenceCount: row.evidence_count,
          evidenceFingerprint: row.evidence_fingerprint,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      valueStances: valueStances
        .map((row) => ({
          id: row.id,
          status: row.status,
          domain: row.analysis_domain,
          targetType: row.target_type,
          targetRef: row.target_ref,
          stance: row.stance,
          orientation: row.orientation,
          scope: canonicalJson(row.scope_json),
          explicitness: row.explicitness,
          confidence: row.confidence,
          evidenceCount: row.evidence_count,
          evidenceFingerprint: row.evidence_fingerprint,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
  const current = await first<{ generation: number }>(repository.selectProfileProjections(env.DB, [ownerUserId]));
  const rebuildState = await first<{ desired_generation: number; built_generation: number }>(
    repository.selectProjectionRebuildStates(env.DB, [ownerUserId]),
  );
  const generation = desiredGeneration ?? rebuildState?.desired_generation ?? (current?.generation ?? 0) + 1;
  if (rebuildState && generation !== rebuildState.desired_generation) throw new Error("PROFILE_BUILD_SUPERSEDED");
  const projectionId = crypto.randomUUID();
  const profileSnapshotId = crypto.randomUUID();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    repository.insertProfileProjections(env.DB, [
      projectionId,
      ownerUserId,
      generation,
      ONTOLOGY_VERSION,
      PROFILE_ALGORITHM_VERSION,
      evidenceSetHash,
      now,
    ]),
    repository.insertProjectionRebuildStates(env.DB, [
      ownerUserId,
      generation,
      rebuildState?.built_generation ?? current?.generation ?? 0,
      projectionId,
      new Date(Date.now() + 10 * 60_000).toISOString(),
      now,
    ]),
  ];
  const itemPayloads: Array<{
    id: string;
    sourceDimensionId: string | null;
    type: "dimension" | "value_stance" | "negative_preference";
    stableKey: string;
    label: string;
    payload: Record<string, unknown>;
    analysisDomain: AnalysisDomain;
  }> = [];
  for (const [index, dimension] of dimensions.entries()) {
    statements.push(
      repository.insertProfileDimensions(env.DB, [
        dimension.id,
        projectionId,
        dimension.attributeDefinitionId,
        dimension.attributeDefinitionId ? dimension.originalLabel : dimension.label,
        dimension.responseChannel,
        dimension.conditionHash,
        dimension.conditionJson,
        dimension.positiveScore,
        dimension.negativeScore,
        dimension.confidence,
        dimension.evidenceCount,
        dimension.identityCount,
        dimension.workCount,
        dimension.classification,
        JSON.stringify(dimension.flags),
        index,
        now,
        dimension.analysisDomain,
      ]),
    );
    itemPayloads.push({
      id: crypto.randomUUID(),
      sourceDimensionId: dimension.id,
      type: dimension.negativeScore > dimension.positiveScore ? "negative_preference" : "dimension",
      stableKey: dimension.stableKey,
      label: dimension.label,
      payload: {
        schemaVersion: "2",
        stableKey: dimension.stableKey,
        originalLabel: dimension.originalLabel,
        category: dimension.category,
        positiveScore: dimension.positiveScore,
        negativeScore: dimension.negativeScore,
        confidence: dimension.confidence,
        responseChannel: dimension.responseChannel,
        condition: JSON.parse(dimension.conditionJson),
        evidenceSummary: {
          identityCount: dimension.identityCount,
          workCount: dimension.workCount,
          evidenceCount: dimension.evidenceCount,
        },
        classification: dimension.classification,
        flags: dimension.flags,
      },
      analysisDomain: dimension.analysisDomain,
    });
  }
  for (const stance of aggregatedValueStances) {
    const targetHash = (await sha256Hex(normalizeIdentityPart(stance.target_ref))).slice(0, 24);
    itemPayloads.push({
      id: crypto.randomUUID(),
      sourceDimensionId: null,
      type: "value_stance",
      stableKey: `value:${stance.orientation}:${stance.stance}:${targetHash}`,
      label: `${stance.target_ref}：${stance.stance}`,
      payload: {
        schemaVersion: "2",
        targetType: stance.target_type,
        targetRef: stance.target_ref,
        orientation: stance.orientation,
        stance: stance.stance,
        scope: JSON.parse(canonicalJson(stance.scope_json)),
        confidence: stance.aggregatedConfidence,
        evidenceSummary: {
          identityCount: stance.identityCount,
          workCount: stance.workCount,
          evidenceCount: stance.evidenceCount,
        },
      },
      analysisDomain: stance.analysis_domain,
    });
  }
  const snapshotContent = itemPayloads.map((item) => ({
    stableKey: item.stableKey,
    type: item.type,
    domain: item.analysisDomain,
    payload: item.payload,
  }));
  const contentHash = await sha256Hex(JSON.stringify(snapshotContent));
  statements.push(
    repository.insertProfileSnapshots(env.DB, [
      profileSnapshotId,
      ownerUserId,
      projectionId,
      generation,
      evidenceSetHash,
      ONTOLOGY_VERSION,
      PROFILE_ALGORITHM_VERSION,
      contentHash,
      now,
    ]),
  );
  for (const [ordinal, item] of itemPayloads.entries()) {
    const payloadJson = JSON.stringify(item.payload);
    statements.push(
      repository.insertProfileSnapshotItems(env.DB, [
        item.id,
        profileSnapshotId,
        item.sourceDimensionId,
        item.type,
        item.stableKey,
        item.label,
        payloadJson,
        await sha256Hex(payloadJson),
        ordinal,
        now,
        item.analysisDomain,
      ]),
    );
  }
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_PROFILE_REBUILD_FAILED");
  const graphProjectionId = await rebuildGraphProjection(env, ownerUserId, projectionId);
  const latest = await first<{ desired_generation: number }>(repository.selectDesiredGeneration(env.DB, [ownerUserId]));
  if (latest?.desired_generation !== generation) {
    await env.DB.batch([
      repository.updateProfileProjections(env.DB, [projectionId]),
      repository.updateGraphProjectionSnapshots(env.DB, [graphProjectionId]),
    ]);
    throw new Error("PROFILE_BUILD_SUPERSEDED");
  }
  const completed = nowIso();
  const switched = await env.DB.batch([
    repository.supersedeCurrentProfile(env.DB, [ownerUserId, ownerUserId, generation]),
    repository.supersedeCurrentGraph(env.DB, [ownerUserId, ownerUserId, generation]),
    repository.activateBuiltProfile(env.DB, [completed, projectionId, ownerUserId, generation]),
    repository.activateBuiltGraph(env.DB, [completed, graphProjectionId, ownerUserId, generation]),
    repository.updateProjectionRebuildStates(env.DB, [generation, completed, ownerUserId, generation]),
  ]);
  if (switched.some((result) => !result.success) || !switched[4].meta.changes)
    throw new Error("D1_PROFILE_CUTOVER_FAILED");
  return { projectionId, profileSnapshotId, graphProjectionId, generation };
}

export async function loadCurrentProfile(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain = "standard",
): Promise<ProfileView | null> {
  const freshness = await loadProjectionFreshness(env, ownerUserId);
  if (freshness.status !== "fresh") return null;
  const projection = await first<{
    id: string;
    generation: number;
    evidence_set_hash: string;
    algorithm_version: string;
    completed_at: string;
  }>(repository.selectCurrentProfile(env.DB, [ownerUserId]));
  if (!projection) return null;
  if (projection.algorithm_version !== PROFILE_ALGORITHM_VERSION) return null;
  const snapshot = await first<{ id: string }>(repository.selectProfileSnapshots(env.DB, [ownerUserId, projection.id]));
  if (!snapshot) throw new Error("PROFILE_SNAPSHOT_MISSING");
  const dimensionRows = await all<{
    id: string;
    stable_key: string | null;
    raw_label: string | null;
    label: string | null;
    category: string | null;
    response_channel: ProfileDimension["responseChannel"];
    condition_json: string;
    positive_score: number;
    negative_score: number;
    confidence: number;
    evidence_count: number;
    identity_count: number;
    work_count: number;
    classification: ProfileDimension["classification"];
    flags_json: string;
  }>(repository.selectProfileDimensions(env.DB, [projection.id, analysisDomain]));
  const stanceRows = buildValueStances(
    (await loadValueStances(env, ownerUserId)).filter((row) => row.analysis_domain === analysisDomain),
  );
  const attributeRows = await all<{ stable_key: string; label: string }>(
    repository.selectActiveAttributeLabels(env.DB, [analysisDomain]),
  );
  const attributeLabels = new Map(attributeRows.map((row) => [row.stable_key, row.label]));
  const entryCount = await first<{ count: number }>(
    repository.selectUserCharacterEntries(env.DB, [ownerUserId, analysisDomain]),
  );
  return {
    projectionId: projection.id,
    generation: projection.generation,
    profileSnapshotId: snapshot.id,
    evidenceSetHash: projection.evidence_set_hash,
    dimensions: dimensionRows.map((row) => ({
      id: row.id,
      stableKey: row.stable_key ?? `raw:${normalizeIdentityPart(row.raw_label ?? "")}`,
      label: row.label ?? row.raw_label ?? "未分類属性",
      ...(row.raw_label ? { originalLabel: row.raw_label } : {}),
      category: row.category ?? "other",
      responseChannel: row.response_channel,
      condition: JSON.parse(canonicalJson(row.condition_json)) as Record<string, unknown>,
      positiveScore: row.positive_score,
      negativeScore: row.negative_score,
      confidence: row.confidence,
      evidenceCount: row.evidence_count,
      identityCount: row.identity_count,
      workCount: row.work_count,
      classification: row.classification,
      flags: JSON.parse(row.flags_json) as string[],
    })),
    valueStances: stanceRows.map((row) => ({
      orientation: row.orientation,
      stance: row.stance,
      count: row.assertionCount,
      labels: [preferenceTargetLabel(row.target_ref, attributeLabels, row.scope_json)],
      targetRef: row.target_ref,
      scope: preferenceContextRecord(row.scope_json),
    })),
    entryCount: entryCount?.count ?? 0,
    updatedAt: projection.completed_at,
  };
}

export async function loadProjectionFreshness(env: Env, ownerUserId: string): Promise<ProjectionFreshness> {
  const [state, current] = await Promise.all([
    first<{
      desired_generation: number;
      built_generation: number;
      status: string;
      last_error_code: string | null;
    }>(repository.selectProjectionFreshness(env.DB, [ownerUserId])),
    first<{ generation: number; algorithm_version: string }>(
      repository.selectCurrentProfileVersion(env.DB, [ownerUserId]),
    ),
  ]);
  if (current && current.algorithm_version !== PROFILE_ALGORITHM_VERSION) {
    return {
      status: "failed",
      desiredGeneration: state?.desired_generation ?? current.generation,
      builtGeneration: state?.built_generation ?? current.generation,
      errorCode: "PROFILE_ALGORITHM_UNSUPPORTED",
    };
  }
  if (state) {
    return {
      status:
        state.status === "failed"
          ? "failed"
          : state.desired_generation === state.built_generation && state.status === "current"
            ? "fresh"
            : "rebuilding",
      desiredGeneration: state.desired_generation,
      builtGeneration: state.built_generation,
      errorCode: state.last_error_code,
    };
  }
  return {
    status: current ? "fresh" : "unavailable",
    desiredGeneration: current?.generation ?? 0,
    builtGeneration: current?.generation ?? 0,
    errorCode: null,
  };
}

export async function processProfileRebuild(env: Env, params: ProfileRebuildWorkflowParams): Promise<void> {
  let claim: JobClaim | undefined;
  try {
    claim = await claimJob(env, params.jobId, params.ownerUserId, params.desiredGeneration, "profile-graph-rebuild");
    if (claim.status === "attempts_exhausted") throw new Error("JOB_STEP_ATTEMPTS_EXHAUSTED");
    if (claim.status !== "claimed") return;
    const result = await rebuildProfile(env, params.ownerUserId, "queued_rebuild", params.desiredGeneration);
    const now = nowIso();
    const committed = await env.DB.batch([
      repository.updateJobs(env.DB, [
        JSON.stringify(result),
        now,
        now,
        params.jobId,
        params.ownerUserId,
        params.desiredGeneration,
      ]),
      repository.updateJobAttempts(env.DB, [now, claim.attemptId, params.jobId]),
    ]);
    if (committed.some((item) => !item.success) || committed.some((item) => !item.meta.changes))
      throw new Error("PROFILE_JOB_FENCE_CHANGED");
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROFILE_REBUILD_FAILED";
    const superseded = code === "PROFILE_BUILD_SUPERSEDED" || code === "PROFILE_JOB_FENCE_CHANGED";
    if (claim?.status === "claimed")
      await finishJobAttempt(env, claim.attemptId, superseded ? "abandoned" : "failed", code);
    const now = nowIso();
    await env.DB.batch([
      repository.recordProfileJobFailure(env.DB, [
        superseded ? "superseded" : "failed",
        superseded ? 0 : 1,
        code,
        now,
        now,
        params.jobId,
      ]),
      ...(!superseded
        ? [repository.recordProjectionFailure(env.DB, [code, now, params.ownerUserId, params.desiredGeneration])]
        : []),
    ]);
    if (!superseded) throw error;
  }
}
