import { describe, expect, it } from "vitest";
import { createDataStoreStrategy } from "../worker/storage/strategy";
import type { Env } from "../worker/types";

function env(strategy: string): Env {
  return { DATASTORE_STRATEGY: strategy } as Env;
}

describe("character taste data-store strategy", () => {
  it("selects the explicit D1 adapter", () => {
    expect(createDataStoreStrategy(env("d1")).id).toBe("d1");
  });

  it("fails fast instead of silently falling back for an unknown adapter", () => {
    expect(() => createDataStoreStrategy(env("external_graph"))).toThrow(
      "DATASTORE_STRATEGY_UNSUPPORTED:external_graph",
    );
  });
});
