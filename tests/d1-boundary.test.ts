import { describe, expect, it } from "vitest";
import { D1_ID_VALIDATION_CHUNK_SIZE, validateSnapshotItemIds } from "../worker/features/generation/selections";
import type { Env } from "../worker/types";

function validationEnv(bindSizes: number[]): Env {
  return {
    DB: {
      prepare: () => ({
        bind: (...bindings: unknown[]) => {
          bindSizes.push(bindings.length);
          return {
            all: async () => ({
              success: true,
              results: bindings.slice(1).map((id) => ({ id })),
            }),
          };
        },
      }),
    },
  } as unknown as Env;
}

describe("D1 snapshot id bind boundaries", () => {
  it.each([99, 100, 101])("chunks %i ids below the D1 bind limit", async (count) => {
    const bindSizes: number[] = [];
    const ids = Array.from({ length: count }, (_, index) => `item-${index}`);
    await expect(validateSnapshotItemIds(validationEnv(bindSizes), "snapshot", ids)).resolves.toBe(true);
    expect(Math.max(...bindSizes)).toBeLessThanOrEqual(D1_ID_VALIDATION_CHUNK_SIZE + 1);
    expect(bindSizes).toHaveLength(Math.ceil(count / D1_ID_VALIDATION_CHUNK_SIZE));
  });

  it("rejects a missing id without issuing an oversized query", async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: (...bindings: unknown[]) => ({
            all: async () => ({ success: true, results: bindings.slice(1, -1).map((id) => ({ id })) }),
          }),
        }),
      },
    } as unknown as Env;
    await expect(validateSnapshotItemIds(env, "snapshot", ["one", "missing"])).resolves.toBe(false);
  });
});
