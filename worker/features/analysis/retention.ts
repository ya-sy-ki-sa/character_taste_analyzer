import type { AnyPreferenceCandidate } from "../../../shared/contracts/preference";
import type { PreferenceHypothesis } from "../../../shared/contracts/refinement";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/retention";

type Row = Record<string, unknown> & { id: string };
export function mergeSelectedPreferenceHypotheses(
  candidate: AnyPreferenceCandidate,
  selected: PreferenceHypothesis[],
  refinementId: string,
  entryScope: string | null,
) {
  const consumed = new Set<AnyPreferenceCandidate["preferenceAssertions"][number]>();
  const additions = selected.map((item, index) => {
    const pointer = `/preference/clarifications/${refinementId}/${index}`;
    const matches = candidate.preferenceAssertions.filter(
      (assertion) =>
        assertion.attributeStableKey === item.attributeStableKey &&
        assertion.responseChannel === item.responseChannel &&
        assertion.polarity === item.polarity &&
        assertion.evidence.some((evidence) => evidence.inputPointer === pointer),
    );
    for (const match of matches) consumed.add(match);
    const primary = matches[0];
    // Keep the model's interpretation when it already covers this explicit selection.
    // Only a missing selection needs a deterministic fallback, preventing duplicate rows.
    if (primary) return { ...primary, context: { ...primary.context, entryScope: item.scope || entryScope } };
    return {
      attributeStableKey: item.attributeStableKey,
      rawLabel: item.rawLabel,
      polarity: item.polarity,
      responseChannel: item.responseChannel,
      strength: 0.5,
      explicitness: "user_explicit" as const,
      confidence: 1,
      context: {
        schemaVersion: "2" as const,
        entryScope: item.scope || entryScope,
        subjects: [],
        relationships: [],
        narrativePhases: [],
        conditions: [],
        exceptions: [],
      },
      evidence: [
        {
          sourceRef: `input:${pointer.slice(1)}`,
          sourceUrl: null,
          inputPointer: pointer,
          quote: item.description.slice(0, 500),
          inferenceType: "direct" as const,
        },
      ],
    };
  });
  candidate.preferenceAssertions = [
    ...additions,
    ...candidate.preferenceAssertions.filter((item) => !consumed.has(item)),
  ] as typeof candidate.preferenceAssertions;
}
export type RetainedPreferences = {
  preferences: Row[];
  stances: Row[];
  summary: AnyPreferenceCandidate["summary"];
};
export async function loadRetainedPreferences(env: Env, owner: string, runId?: string): Promise<RetainedPreferences> {
  if (!runId)
    return { preferences: [], stances: [], summary: { userExplicitSummary: [], inferredSummary: [], limitations: [] } };
  const [preferences, stances, run] = await Promise.all([
    all<Row>(repository.selectPreferenceAssertions(env.DB, [runId, owner])),
    all<Row>(repository.selectValueStanceAssertions(env.DB, [runId, owner])),
    first<{ summary_json: string }>(repository.selectAnalysisRuns(env.DB, [runId, owner])),
  ]);
  // Rebuild the retained summary from live rows so deleted or corrected descriptions do not return.
  return {
    preferences,
    stances,
    summary: {
      userExplicitSummary: preferences
        .filter((row) => ["user_explicit", "user_confirmed"].includes(String(row.explicitness)))
        .map((row) => String(row.raw_label)),
      inferredSummary: preferences
        .filter((row) => !["user_explicit", "user_confirmed"].includes(String(row.explicitness)))
        .map((row) => String(row.raw_label)),
      limitations: run ? (JSON.parse(run.summary_json).limitations ?? []) : [],
    },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  return JSON.stringify(value);
}
function preferenceKey(attribute: unknown, label: unknown, polarity: unknown, channel: unknown, context: unknown) {
  return canonical([attribute ?? label, polarity, channel, context]);
}
export function mergeRetainedPreferences(candidate: AnyPreferenceCandidate, retained: RetainedPreferences) {
  const keys = new Set(
    retained.preferences.map((row) =>
      preferenceKey(
        row.stable_key,
        row.raw_label,
        row.polarity,
        row.response_channel,
        JSON.parse(String(row.context_json)),
      ),
    ),
  );
  candidate.preferenceAssertions = candidate.preferenceAssertions.filter((item) => {
    const key = preferenceKey(
      item.attributeStableKey,
      item.rawLabel,
      item.polarity,
      item.responseChannel,
      item.context,
    );
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  }) as typeof candidate.preferenceAssertions;
  const stanceKeys = new Set(
    retained.stances.map((row) =>
      canonical([row.target_type, row.target_ref, row.stance, row.orientation, JSON.parse(String(row.scope_json))]),
    ),
  );
  candidate.valueStanceAssertions = candidate.valueStanceAssertions.filter((item) => {
    const key = canonical([item.targetType, item.targetRef, item.stance, item.orientation, item.context]);
    if (stanceKeys.has(key)) return false;
    stanceKeys.add(key);
    return true;
  });
  for (const field of ["userExplicitSummary", "inferredSummary"] as const) {
    const explicit = field === "userExplicitSummary";
    candidate.summary[field] = [
      ...new Set([
        ...retained.summary[field],
        ...candidate.preferenceAssertions
          .filter((item) => ["user_explicit", "user_confirmed"].includes(item.explicitness) === explicit)
          .map((item) => item.rawLabel),
      ]),
    ];
  }
  candidate.summary.limitations = [...new Set([...retained.summary.limitations, ...candidate.summary.limitations])];
}
export async function retainPreferenceStatements(
  env: Env,
  owner: string,
  runId: string,
  retained: RetainedPreferences,
) {
  const statements: D1PreparedStatement[] = [];
  const clone = (table: string, row: Record<string, unknown>, updates: Record<string, unknown>) => {
    const values = { ...row, ...updates };
    // Column names come only from database rows and the fixed overrides below.
    const columns = Object.keys(values);
    statements.push(
      repository.prepareQuery(env.DB, table, columns.join(","), columns.map(() => "?").join(","), [
        ...Object.values(values),
      ]),
    );
  };
  for (const [rows, table, type] of [
    [retained.preferences, "preference_assertions", "preference_assertion"],
    [retained.stances, "value_stance_assertions", "value_stance_assertion"],
  ] as const) {
    for (const original of rows) {
      const id = crypto.randomUUID();
      const { raw_label: _label, stable_key: _key, ...row } = original;
      if (type === "preference_assertion" && row.raw_mention_id) {
        const raw = await first<Row>(repository.selectRawAttributeMentions(env.DB, [row.raw_mention_id, owner]));
        if (raw) {
          const rawId = crypto.randomUUID();
          clone("raw_attribute_mentions", raw, { id: rawId, source_ref_id: id });
          const mappings = await all<Row>(repository.selectAttributeMappings(env.DB, [raw.id]));
          for (const mapping of mappings)
            clone("attribute_mappings", mapping, { id: crypto.randomUUID(), raw_mention_id: rawId });
          row.raw_mention_id = rawId;
        }
      }
      clone(table, row, { id, analysis_run_id: runId });
      const evidence = await all<Row>(repository.selectEvidenceFragments(env.DB, [owner, type, original.id]));
      for (const fragment of evidence) clone("evidence_fragments", fragment, { id: crypto.randomUUID(), owner_id: id });
    }
  }
  return statements;
}
