import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { ProfileDimension, ProfileView, ProjectionFreshness } from "../../../shared/contracts/profile-response";
import { PROFILE_ALGORITHM_VERSION } from "../../../shared/profile-algorithm";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env, ProfileRebuildWorkflowParams } from "../../types";
import { claimJob, finishJobAttempt, type JobClaim } from "../jobs/execution";
import { profileConditionJson } from "./context";
import { rebuildGraphProjection } from "./graph";
import * as repository from "./repositories/projection";

const ONTOLOGY_VERSION = "standard-1.0+dark-1.0";

type AssertionRow = {
  id: string;
  entry_id: string;
  entry_revision_id: string;
  character_identity_id: string;
  work_id: string | null;
  attribute_definition_id: string | null;
  stable_key: string | null;
  label: string | null;
  category: string | null;
  raw_label: string;
  normalized_label: string;
  polarity: "positive" | "negative" | "mixed";
  response_channel: ProfileDimension["responseChannel"];
  strength: number;
  explicitness: "user_explicit" | "user_confirmed" | "inferred" | "model_knowledge";
  confidence: number;
  context_json: string;
  status: "confirmed" | "corrected";
  evidence_count: number;
  evidence_quality: number;
  evidence_fingerprint: string;
  analysis_domain: AnalysisDomain;
};

type WeightedAssertion = AssertionRow & {
  dimensionKey: string;
  conditionHash: string;
  conditionJson: string;
  contribution: number;
  positiveContribution: number;
  negativeContribution: number;
  userExplicitContribution: number;
};

type BuiltDimension = {
  id: string;
  attributeDefinitionId: string | null;
  stableKey: string;
  label: string;
  category: string;
  responseChannel: ProfileDimension["responseChannel"];
  conditionHash: string;
  conditionJson: string;
  positiveScore: number;
  negativeScore: number;
  confidence: number;
  evidenceCount: number;
  identityCount: number;
  workCount: number;
  classification: ProfileDimension["classification"];
  flags: string[];
  rankScore: number;
  analysisDomain: AnalysisDomain;
};

type ValueStanceRow = {
  id: string;
  entry_id: string;
  character_identity_id: string;
  work_id: string | null;
  target_type: string;
  target_ref: string;
  stance: string;
  orientation: string;
  scope_json: string;
  explicitness: "user_explicit" | "user_confirmed" | "inferred";
  confidence: number;
  evidence_quality: number;
  evidence_count: number;
  evidence_fingerprint: string;
  status: "confirmed" | "corrected";
  analysis_domain: AnalysisDomain;
};

type AggregatedValueStance = ValueStanceRow & {
  aggregatedConfidence: number;
  identityCount: number;
  workCount: number;
  evidenceCount: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000;
}

function explicitnessWeight(value: AssertionRow["explicitness"] | ValueStanceRow["explicitness"]): number {
  if (value === "user_explicit") return 1;
  if (value === "user_confirmed") return 0.95;
  if (value === "inferred") return 0.55;
  return 0.25;
}

function discountedUnion(values: number[], discount: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const [maximum, ...rest] = sorted;
  const restUnion = 1 - rest.reduce((product, value) => product * (1 - value), 1);
  return clamp01(maximum + discount * (1 - maximum) * restUnion);
}

function independentUnion(values: number[]): number {
  return clamp01(1 - values.reduce((product, value) => product * (1 - value), 1));
}

function aggregatePolarity(rows: WeightedAssertion[], field: "positiveContribution" | "negativeContribution"): number {
  const entryMax = new Map<string, WeightedAssertion>();
  for (const row of rows) {
    const current = entryMax.get(row.entry_id);
    if (!current || row[field] > current[field]) entryMax.set(row.entry_id, row);
  }
  const identities = new Map<string, WeightedAssertion[]>();
  for (const row of entryMax.values()) {
    const group = identities.get(row.character_identity_id) ?? [];
    group.push(row);
    identities.set(row.character_identity_id, group);
  }
  const works = new Map<string, number[]>();
  for (const [identityId, identityRows] of identities) {
    const value = discountedUnion(
      identityRows.map((row) => row[field]),
      0.25,
    );
    const workKey = identityRows[0]?.work_id ?? `original:${identityId}`;
    const group = works.get(workKey) ?? [];
    group.push(value);
    works.set(workKey, group);
  }
  return independentUnion([...works.values()].map((values) => discountedUnion(values, 0.5)));
}

function canonicalJson(input: string): string {
  try {
    const sort = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sort);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, sort(nested)]),
        );
      }
      return value;
    };
    return JSON.stringify(sort(JSON.parse(input)));
  } catch {
    return "{}";
  }
}

async function weightAssertions(rows: AssertionRow[]): Promise<WeightedAssertion[]> {
  return Promise.all(
    rows.map(async (row) => {
      const conditionJson = profileConditionJson(row.context_json);
      const conditionHash = await sha256Hex(conditionJson);
      const stableKey = row.stable_key ?? `raw:${normalizeIdentityPart(row.normalized_label || row.raw_label)}`;
      const contribution = clamp01(
        row.strength * row.confidence * explicitnessWeight(row.explicitness) * row.evidence_quality,
      );
      return {
        ...row,
        dimensionKey: `${row.analysis_domain}\u0000${stableKey}\u0000${row.response_channel ?? ""}\u0000${conditionHash}`,
        conditionHash,
        conditionJson,
        contribution,
        positiveContribution:
          row.polarity === "negative" ? 0 : row.polarity === "mixed" ? contribution * 0.5 : contribution,
        negativeContribution:
          row.polarity === "positive" ? 0 : row.polarity === "mixed" ? contribution * 0.5 : contribution,
        userExplicitContribution: row.explicitness === "user_explicit" ? contribution : 0,
      };
    }),
  );
}

function buildDimensions(rows: WeightedAssertion[]): BuiltDimension[] {
  const groups = new Map<string, WeightedAssertion[]>();
  for (const row of rows) {
    const group = groups.get(row.dimensionKey) ?? [];
    group.push(row);
    groups.set(row.dimensionKey, group);
  }
  const dimensions: BuiltDimension[] = [];
  for (const group of groups.values()) {
    const firstRow = group[0];
    const positiveScore = round6(aggregatePolarity(group, "positiveContribution"));
    const negativeScore = round6(aggregatePolarity(group, "negativeContribution"));
    const identities = new Set(group.map((row) => row.character_identity_id));
    const works = new Set(group.map((row) => row.work_id ?? `original:${row.character_identity_id}`));
    const evidenceCount = group.reduce((sum, row) => sum + row.evidence_count, 0);
    const identityDiversity = Math.min(1, identities.size / 3);
    const workDiversity = Math.min(1, works.size / 2);
    const evidenceDiversity = Math.min(1, evidenceCount / 5);
    const diversity = 0.4 * identityDiversity + 0.35 * workDiversity + 0.25 * evidenceDiversity;
    const maximum = Math.max(positiveScore, negativeScore);
    const confidence = round6(maximum * (0.55 + 0.45 * diversity));
    const explicitMaximum = Math.max(...group.map((row) => row.userExplicitContribution), 0);
    const classification: BuiltDimension["classification"] =
      maximum >= 0.65 && confidence >= 0.65 && identities.size >= 3 && works.size >= 2
        ? "stable"
        : maximum >= 0.35 || explicitMaximum >= 0.5
          ? "emerging"
          : "insufficient";
    const conditionJson = firstRow.conditionJson;
    const condition = JSON.parse(conditionJson) as Record<string, unknown>;
    const flags = [
      ...(!firstRow.attribute_definition_id ? ["unmapped"] : []),
      ...(Object.entries(condition).some(
        ([key, value]) => key !== "schemaVersion" && (Array.isArray(value) ? value.length > 0 : Boolean(value)),
      )
        ? ["conditional"]
        : []),
      ...(positiveScore >= 0.4 && negativeScore >= 0.4 ? ["contrast"] : []),
    ];
    const factor = classification === "stable" ? 1 : classification === "emerging" ? 0.8 : 0.5;
    dimensions.push({
      id: crypto.randomUUID(),
      attributeDefinitionId: firstRow.attribute_definition_id,
      stableKey: firstRow.stable_key ?? `raw:${normalizeIdentityPart(firstRow.normalized_label || firstRow.raw_label)}`,
      label: firstRow.label ?? firstRow.raw_label,
      category: firstRow.category ?? "other",
      responseChannel: firstRow.response_channel,
      conditionHash: firstRow.conditionHash,
      conditionJson,
      positiveScore,
      negativeScore,
      confidence,
      evidenceCount,
      identityCount: identities.size,
      workCount: works.size,
      classification,
      flags,
      rankScore: maximum * confidence * factor,
      analysisDomain: firstRow.analysis_domain,
    });
  }
  return dimensions.sort(
    (a, b) => b.rankScore - a.rankScore || b.evidenceCount - a.evidenceCount || a.stableKey.localeCompare(b.stableKey),
  );
}

function buildValueStances(rows: ValueStanceRow[]): AggregatedValueStance[] {
  const groups = new Map<string, ValueStanceRow[]>();
  for (const row of rows) {
    const key = [
      row.analysis_domain,
      row.target_type,
      normalizeIdentityPart(row.target_ref),
      row.orientation,
      row.stance,
      canonicalJson(row.scope_json),
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const contribution = (row: ValueStanceRow) =>
      clamp01(row.confidence * explicitnessWeight(row.explicitness) * row.evidence_quality);
    const entryMax = new Map<string, ValueStanceRow>();
    for (const row of group) {
      const current = entryMax.get(row.entry_id);
      if (!current || contribution(row) > contribution(current)) entryMax.set(row.entry_id, row);
    }
    const identities = new Map<string, ValueStanceRow[]>();
    for (const row of entryMax.values()) {
      const identityGroup = identities.get(row.character_identity_id) ?? [];
      identityGroup.push(row);
      identities.set(row.character_identity_id, identityGroup);
    }
    const works = new Map<string, number[]>();
    for (const [identityId, identityRows] of identities) {
      const identityScore = discountedUnion(identityRows.map(contribution), 0.25);
      const workKey = identityRows[0]?.work_id ?? `original:${identityId}`;
      const workGroup = works.get(workKey) ?? [];
      workGroup.push(identityScore);
      works.set(workKey, workGroup);
    }
    return {
      ...group[0],
      aggregatedConfidence: round6(independentUnion([...works.values()].map((values) => discountedUnion(values, 0.5)))),
      identityCount: identities.size,
      workCount: works.size,
      evidenceCount: group.reduce((sum, row) => sum + row.evidence_count, 0),
    };
  });
}

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
        dimension.attributeDefinitionId ? null : dimension.label,
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
  const latest = await first<{ desired_generation: number }>(
    repository.selectProjectionRebuildStates2(env.DB, [ownerUserId]),
  );
  if (latest?.desired_generation !== generation) {
    await env.DB.batch([
      repository.updateProfileProjections(env.DB, [projectionId]),
      repository.updateGraphProjectionSnapshots(env.DB, [graphProjectionId]),
    ]);
    throw new Error("PROFILE_BUILD_SUPERSEDED");
  }
  const completed = nowIso();
  const switched = await env.DB.batch([
    repository.updateProfileProjections2(env.DB, [ownerUserId, ownerUserId, generation]),
    repository.updateGraphProjectionSnapshots2(env.DB, [ownerUserId, ownerUserId, generation]),
    repository.updateProfileProjections3(env.DB, [completed, projectionId, ownerUserId, generation]),
    repository.updateGraphProjectionSnapshots3(env.DB, [completed, graphProjectionId, ownerUserId, generation]),
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
  }>(repository.selectProfileProjections2(env.DB, [ownerUserId]));
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
  const stanceRows = await all<{ orientation: string; stance: string; count: number; labels: string }>(
    repository.selectValueStanceAssertions2(env.DB, [analysisDomain, ownerUserId, analysisDomain]),
  );
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
      count: row.count,
      labels: JSON.parse(row.labels) as string[],
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
    }>(repository.selectProjectionRebuildStates3(env.DB, [ownerUserId])),
    first<{ generation: number; algorithm_version: string }>(
      repository.selectProfileProjections3(env.DB, [ownerUserId]),
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
      repository.updateJobs2(env.DB, [
        superseded ? "superseded" : "failed",
        superseded ? 0 : 1,
        code,
        now,
        now,
        params.jobId,
      ]),
      ...(!superseded
        ? [repository.updateProjectionRebuildStates2(env.DB, [code, now, params.ownerUserId, params.desiredGeneration])]
        : []),
    ]);
    if (!superseded) throw error;
  }
}
