import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export const fixtureTime = "2026-01-01T00:00:00.000Z";

// Only test-owned table/column names are accepted by callers of this fixture helper.
export function insertFixture(database: DatabaseSync, table: string, values: Record<string, SQLInputValue>) {
  const columns = Object.keys(values);
  if (![table, ...columns].every((name) => /^[a-z_]+$/.test(name))) throw new Error("Invalid fixture identifier");
  database
    .prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...Object.values(values));
}
export function seedUser(database: DatabaseSync, id = "owner") {
  insertFixture(database, "users", {
    id,
    username: id,
    username_normalized: id,
    status: "active",
    created_at: fixtureTime,
    updated_at: fixtureTime,
  });
}
export function seedEntry(
  database: DatabaseSync,
  {
    id = "entry",
    status = "submitted",
    generation = 1,
    payload = { registrationType: "original", characterName: "試験キャラクター", characterBasicInfo: "架空の試験資料" },
  }: { id?: string; status?: string; generation?: number; payload?: Record<string, unknown> } = {},
) {
  const identity = `${id}-identity`,
    representation = `${id}-representation`,
    revision = `${id}-revision`;
  insertFixture(database, "character_identities", {
    id: identity,
    owner_user_id: "owner",
    origin_type: "original",
    name: "試験キャラクター",
    name_normalized: "試験キャラクター",
    created_at: fixtureTime,
    updated_at: fixtureTime,
  });
  insertFixture(database, "character_representations", {
    id: representation,
    character_identity_id: identity,
    owner_user_id: "owner",
    representation_type: "original",
    canonicality: "original",
    scope_type: "whole",
    scope_description: "全体",
    created_at: fixtureTime,
    updated_at: fixtureTime,
  });
  insertFixture(database, "user_character_entries", {
    id,
    owner_user_id: "owner",
    registration_type: String(payload.registrationType),
    status,
    active_revision_number: generation,
    creation_idempotency_hash: id,
    created_at: fixtureTime,
    updated_at: fixtureTime,
    archived_at: status === "archived" ? fixtureTime : null,
  });
  insertFixture(database, "entry_revisions", {
    id: revision,
    entry_id: id,
    revision_number: generation,
    representation_id: representation,
    preference_input_json: "{}",
    registration_payload_json: JSON.stringify(payload),
    content_hash: id,
    created_at: fixtureTime,
  });
  return { identity, representation, revision };
}
export function seedReview(database: DatabaseSync) {
  seedUser(database);
  const { identity, representation, revision } = seedEntry(database, { status: "analysis_review" });
  insertFixture(database, "character_understanding_runs", {
    id: "understanding-run",
    owner_user_id: "owner",
    entry_revision_id: revision,
    representation_id: representation,
    run_generation: 1,
    status: "succeeded",
    created_at: fixtureTime,
  });
  insertFixture(database, "character_understanding_snapshots", {
    id: "understanding",
    owner_user_id: "owner",
    understanding_run_id: "understanding-run",
    representation_id: representation,
    snapshot_generation: 1,
    status: "confirmed",
    overall_confidence: 1,
    source_assessment_json: "{}",
    summary_json: "{}",
    ontology_version: "1.0",
    content_hash: "fixture",
    created_at: fixtureTime,
  });
  insertFixture(database, "analysis_runs", {
    id: "run",
    owner_user_id: "owner",
    entry_revision_id: revision,
    understanding_snapshot_id: "understanding",
    run_generation: 1,
    status: "succeeded",
    ontology_version: "1.0",
    summary_json: "{}",
    created_at: fixtureTime,
  });
  insertFixture(database, "preference_assertions", {
    id: "preference",
    owner_user_id: "owner",
    analysis_run_id: "run",
    entry_revision_id: revision,
    character_identity_id: identity,
    representation_id: representation,
    polarity: "positive",
    response_channel: "narrative_interest",
    strength: 1,
    explicitness: "user_explicit",
    confidence: 1,
    status: "proposed",
    created_at: fixtureTime,
  });
  insertFixture(database, "value_stance_assertions", {
    id: "stance",
    owner_user_id: "owner",
    analysis_run_id: "run",
    target_type: "value",
    target_ref: "知略",
    stance: "accept",
    orientation: "self_defined",
    explicitness: "user_explicit",
    confidence: 1,
    status: "proposed",
    created_at: fixtureTime,
  });
}
