import type { PreferenceHypothesis } from "../../shared/quality-schemas";
import type { AnyPreferenceCandidate } from "../../shared/schemas";
import { all, first } from "../lib/db";
import type { Env } from "../types";

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
    all<Row>(
      env.DB.prepare(
        `SELECT pa.*,rm.raw_label,d.stable_key FROM preference_assertions pa LEFT JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id LEFT JOIN attribute_definitions d ON d.id=pa.attribute_definition_id WHERE pa.analysis_run_id=? AND pa.owner_user_id=? AND pa.status NOT IN ('rejected','superseded') ORDER BY pa.created_at,pa.id`,
      ).bind(runId, owner),
    ),
    all<Row>(
      env.DB.prepare(
        `SELECT * FROM value_stance_assertions WHERE analysis_run_id=? AND owner_user_id=? AND status NOT IN ('rejected','superseded') ORDER BY created_at,id`,
      ).bind(runId, owner),
    ),
    first<{ summary_json: string }>(
      env.DB.prepare(`SELECT summary_json FROM analysis_runs WHERE id=? AND owner_user_id=?`).bind(runId, owner),
    ),
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
      env.DB.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(
        ...Object.values(values),
      ),
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
        const raw = await first<Row>(
          env.DB.prepare(`SELECT * FROM raw_attribute_mentions WHERE id=? AND owner_user_id=?`).bind(
            row.raw_mention_id,
            owner,
          ),
        );
        if (raw) {
          const rawId = crypto.randomUUID();
          clone("raw_attribute_mentions", raw, { id: rawId, source_ref_id: id });
          const mappings = await all<Row>(
            env.DB.prepare(`SELECT * FROM attribute_mappings WHERE raw_mention_id=?`).bind(raw.id),
          );
          for (const mapping of mappings)
            clone("attribute_mappings", mapping, { id: crypto.randomUUID(), raw_mention_id: rawId });
          row.raw_mention_id = rawId;
        }
      }
      clone(table, row, { id, analysis_run_id: runId });
      const evidence = await all<Row>(
        env.DB.prepare(`SELECT * FROM evidence_fragments WHERE owner_user_id=? AND owner_type=? AND owner_id=?`).bind(
          owner,
          type,
          original.id,
        ),
      );
      for (const fragment of evidence) clone("evidence_fragments", fragment, { id: crypto.randomUUID(), owner_id: id });
    }
  }
  return statements;
}
