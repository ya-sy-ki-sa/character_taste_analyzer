import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createD1DataStoreStrategy } from "../worker/storage/d1-strategy";
import type { Env } from "../worker/types";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new TestStatement(this.database, this.sql, values as SqlValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values) as T[],
      meta: { changes: 0 },
    };
  }
}

function testDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE projection_rebuild_states (
      owner_user_id TEXT PRIMARY KEY,
      desired_generation INTEGER NOT NULL,
      built_generation INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error_code TEXT
    );
    CREATE TABLE profile_projections (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE profile_snapshots (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      profile_projection_id TEXT,
      profile_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE profile_snapshot_items (
      id TEXT PRIMARY KEY,
      profile_snapshot_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      stable_key TEXT NOT NULL,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      analysis_domain TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE attribute_schema_versions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      analysis_domain TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE attribute_definitions (
      id TEXT PRIMARY KEY,
      schema_version_id TEXT NOT NULL,
      stable_key TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO projection_rebuild_states VALUES ('owner',1,1,'current',NULL);
    INSERT INTO profile_projections VALUES ('current-projection','owner','current');
    INSERT INTO profile_snapshots VALUES
      ('orphan-generation-15','owner',NULL,15,'2026-01-01T00:00:00.000Z'),
      ('current-generation-1','owner','current-projection',1,'2026-01-02T00:00:00.000Z');
    INSERT INTO profile_snapshot_items VALUES
      ('orphan-item','orphan-generation-15','dimension','orphan','古い項目','{}',0,'standard'),
      ('current-item','current-generation-1','dimension','current','現在の項目','{}',0,'standard');
  `);
  const d1 = {
    prepare(sql: string) {
      return new TestStatement(database, sql);
    },
  } as unknown as D1Database;
  return { database, env: { DB: d1 } as unknown as Env };
}

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.database.close();
  current = undefined;
});

describe("profile snapshot item selection", () => {
  it("returns the snapshot attached to the current projection instead of a higher orphan generation", async () => {
    current = testDatabase();

    const result = await createD1DataStoreStrategy(current.env).loadProfileSnapshotItems("owner", "standard");

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
