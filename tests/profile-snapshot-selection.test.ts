import { afterEach, describe, expect, it } from "vitest";
import { loadProjectionFreshness } from "../worker/features/profile/projection";
import { loadProfileSnapshotItems } from "../worker/features/profile/snapshot";
import { testDatabase } from "./support/database";
import { fixtureTime, insertFixture, seedUser } from "./support/fixtures";

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("profile snapshot item selection", () => {
  it("reports unsupported algorithms without inventing a rebuild generation", async () => {
    current = testDatabase();
    seedUser(current.database);
    insertFixture(current.database, "projection_rebuild_states", {
      owner_user_id: "owner",
      desired_generation: 1,
      built_generation: 1,
      status: "current",
      updated_at: fixtureTime,
    });
    insertFixture(current.database, "profile_projections", {
      id: "current-projection",
      owner_user_id: "owner",
      generation: 1,
      ontology_version: "1.0",
      algorithm_version: "profile/v1.2.0-domain-aware",
      evidence_set_hash: "fixture",
      status: "current",
      created_at: fixtureTime,
    });
    for (const [id, generation, projection, label] of [
      ["orphan-generation-15", 15, null, "古い項目"],
      ["current-generation-1", 1, "current-projection", "現在の項目"],
    ] as const) {
      insertFixture(current.database, "profile_snapshots", {
        id,
        owner_user_id: "owner",
        profile_projection_id: projection,
        profile_generation: generation,
        evidence_set_hash: "fixture",
        ontology_version: "1.0",
        algorithm_version: "profile/v1.2.0-domain-aware",
        correction_version: 0,
        content_hash: "fixture",
        reason: "profile_rebuild",
        created_at: fixtureTime,
      });
      const key = projection ? "current" : "orphan";
      insertFixture(current.database, "profile_snapshot_items", {
        id: key + "-item",
        profile_snapshot_id: id,
        item_type: "dimension",
        stable_key: key,
        label,
        payload_json: "{}",
        content_hash: "fixture",
        created_at: fixtureTime,
        ordinal: 0,
        analysis_domain: "standard",
      });
    }
    current.database.exec("UPDATE profile_projections SET algorithm_version='profile/v1.1.0'");
    expect(await loadProjectionFreshness(current.env, "owner")).toEqual({
      status: "failed",
      desiredGeneration: 1,
      builtGeneration: 1,
      errorCode: "PROFILE_ALGORITHM_UNSUPPORTED",
    });
    expect(await loadProfileSnapshotItems(current.env, "owner", "standard")).toEqual({
      snapshot: null,
      items: [],
    });
    expect(
      current.database.prepare("SELECT desired_generation FROM projection_rebuild_states").get()?.desired_generation,
    ).toBe(1);
  });

  it("returns the snapshot attached to the current projection instead of a higher orphan generation", async () => {
    current = testDatabase();
    seedUser(current.database);
    insertFixture(current.database, "projection_rebuild_states", {
      owner_user_id: "owner",
      desired_generation: 1,
      built_generation: 1,
      status: "current",
      updated_at: fixtureTime,
    });
    insertFixture(current.database, "profile_projections", {
      id: "current-projection",
      owner_user_id: "owner",
      generation: 1,
      ontology_version: "1.0",
      algorithm_version: "profile/v1.2.0-domain-aware",
      evidence_set_hash: "fixture",
      status: "current",
      created_at: fixtureTime,
    });
    for (const [id, generation, projection, label] of [
      ["orphan-generation-15", 15, null, "古い項目"],
      ["current-generation-1", 1, "current-projection", "現在の項目"],
    ] as const) {
      insertFixture(current.database, "profile_snapshots", {
        id,
        owner_user_id: "owner",
        profile_projection_id: projection,
        profile_generation: generation,
        evidence_set_hash: "fixture",
        ontology_version: "1.0",
        algorithm_version: "profile/v1.2.0-domain-aware",
        correction_version: 0,
        content_hash: "fixture",
        reason: "profile_rebuild",
        created_at: fixtureTime,
      });
      const key = projection ? "current" : "orphan";
      insertFixture(current.database, "profile_snapshot_items", {
        id: key + "-item",
        profile_snapshot_id: id,
        item_type: "dimension",
        stable_key: key,
        label,
        payload_json: "{}",
        content_hash: "fixture",
        created_at: fixtureTime,
        ordinal: 0,
        analysis_domain: "standard",
      });
    }

    const result = await loadProfileSnapshotItems(current.env, "owner", "standard");

    expect(result.snapshot).toEqual({ id: "current-generation-1", generation: 1 });
    expect(result.items).toEqual([
      {
        id: "current-item",
        type: "dimension",
        stableKey: "current",
        label: "現在の項目",
        payload: {},
      },
    ]);
  });
});
