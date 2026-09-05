import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { ProfileDimension } from "../../../shared/contracts/profile-response";
import { normalizeIdentityPart, sha256Hex } from "../../lib/crypto";
import { profileConditionJson } from "./context";

export type AssertionRow = {
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
  originalLabel: string;
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

export type ValueStanceRow = {
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
  assertionCount: number;
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

export function aggregateContributions<
  Row extends {
    entry_id: string;
    character_identity_id: string;
    work_id: string | null;
  },
>(
  rows: Row[],
  contribution: (row: Row) => number,
): {
  score: number;
  identityCount: number;
  workCount: number;
} {
  const entryMax = new Map<string, Row>();
  for (const row of rows) {
    const current = entryMax.get(row.entry_id);
    if (!current || contribution(row) > contribution(current)) entryMax.set(row.entry_id, row);
  }
  const identities = new Map<string, Row[]>();
  for (const row of entryMax.values()) {
    const group = identities.get(row.character_identity_id) ?? [];
    group.push(row);
    identities.set(row.character_identity_id, group);
  }
  const works = new Map<string, number[]>();
  for (const [identityId, identityRows] of identities) {
    const value = discountedUnion(identityRows.map(contribution), 0.25);
    const workKey = identityRows[0]?.work_id ?? `original:${identityId}`;
    const group = works.get(workKey) ?? [];
    group.push(value);
    works.set(workKey, group);
  }
  return {
    score: independentUnion([...works.values()].map((values) => discountedUnion(values, 0.5))),
    identityCount: identities.size,
    workCount: works.size,
  };
}

export function canonicalJson(input: string): string {
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

export async function weightAssertions(rows: AssertionRow[]): Promise<WeightedAssertion[]> {
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

export function buildDimensions(rows: WeightedAssertion[]): BuiltDimension[] {
  const groups = new Map<string, WeightedAssertion[]>();
  for (const row of rows) {
    const group = groups.get(row.dimensionKey) ?? [];
    group.push(row);
    groups.set(row.dimensionKey, group);
  }
  const dimensions: BuiltDimension[] = [];
  for (const group of groups.values()) {
    const firstRow = group[0];
    const positiveScore = round6(aggregateContributions(group, (row) => row.positiveContribution).score);
    const negativeScore = round6(aggregateContributions(group, (row) => row.negativeContribution).score);
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
      ...(firstRow.response_channel === null ? ["response_channel_unresolved"] : []),
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
      originalLabel: [...new Set(group.map((row) => row.raw_label))].join("／"),
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

export function buildValueStances(rows: ValueStanceRow[]): AggregatedValueStance[] {
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
    const aggregated = aggregateContributions(group, contribution);
    return {
      ...group[0],
      assertionCount: group.length,
      aggregatedConfidence: round6(aggregated.score),
      identityCount: aggregated.identityCount,
      workCount: aggregated.workCount,
      evidenceCount: group.reduce((sum, row) => sum + row.evidence_count, 0),
    };
  });
}
