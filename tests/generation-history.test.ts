import { describe, expect, it } from "vitest";
import { listGenerations } from "../worker/features/generation/history";
import type { Env } from "../worker/types";

describe("generation history grouping", () => {
  it("retains request order, candidate order and selection when rows from multiple requests interleave", async () => {
    const requests = ["second", "pending", "first"].map((id) => ({
      id: null,
      request_id: id,
      status: id === "pending" ? "generating" : "generated",
      mode: "balanced",
      created_at: "2026-09-05T00:00:00.000Z",
      character_json: null,
      job_status: "succeeded",
      error_code: null,
    }));
    const candidates = [
      ["first", 1],
      ["second", 1],
      ["first", 2],
      ["second", 2],
    ].map(([request, ordinal]) => ({
      id: `${request}-${ordinal}`,
      generation_request_id: request,
      ordinal,
      character_json: JSON.stringify({ identity: { name: `${request}-${ordinal}` } }),
      comparison_json: "{}",
      selected_at: ordinal === 2 ? "2026-09-05" : null,
    }));
    const bindings: unknown[][] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => {
            bindings.push(values);
            return {
              all: async () => ({ success: true, results: sql.includes("SELECT c.*") ? candidates : requests }),
            };
          },
        }),
      },
    } as unknown as Env;
    const result = await listGenerations(env, "owner", "dark");
    expect(bindings).toEqual([
      ["owner", "dark"],
      ["owner", "dark"],
    ]);
    expect(result.map((item) => item.generationRequestId)).toEqual(["second", "pending", "first"]);
    expect(
      result.map((item) => item.candidates.map((candidate) => [candidate.character.identity.name, candidate.selected])),
    ).toEqual([
      [
        ["second-1", false],
        ["second-2", true],
      ],
      [],
      [
        ["first-1", false],
        ["first-2", true],
      ],
    ]);
  });
});
