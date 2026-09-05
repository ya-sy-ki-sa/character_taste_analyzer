import { describe, expect, it } from "vitest";
import { entryDraftSchema } from "../shared/contracts/entries";
import type { UnderstandingCandidate } from "../shared/contracts/understanding";
import { fakeUnderstanding } from "../worker/features/analysis/deterministic";
import { understandOne } from "../worker/features/analysis/llm-understanding";
import type { EntryContext } from "../worker/features/analysis/types";
import {
  explainUnknownUnderstandingAspects,
  understandingQualityIssues,
} from "../worker/features/analysis/understanding-quality";
import { type LlmProvider, LlmProviderError, type StructuredLlmRequest } from "../worker/llm/types";
import type { Env } from "../worker/types";

const payload = entryDraftSchema.parse({
  registrationType: "existing",
  workTitle: "テスト作品",
  characterName: "テスト人物",
  identityResolution: { mode: "new" },
  preference: { responseChannels: [] },
});
const env = { AUTH_PEPPER: "test" } as Env;
const research = { status: "collected" as const, sources: [] };

function known(): UnderstandingCandidate {
  const result = fakeUnderstanding(payload, false);
  result.summary.behavior = ["仲間の危機に助けに向かう"];
  return result;
}

// Reproduces B05: identity and an identification assertion exist, all seven aspects are empty.
function identityOnly(): UnderstandingCandidate {
  const result = known();
  result.summary.behavior = [];
  result.uncertainties = [{ topic: "人物像", reason: "公開資料は登場人物の同定のみ" }];
  return result;
}

function setup(outputs: Array<UnderstandingCandidate | LlmProviderError>, draft = payload) {
  const requests: StructuredLlmRequest<unknown>[] = [];
  const llm: LlmProvider = {
    providerId: "replay",
    async generateStructured<T>(request: StructuredLlmRequest<T>) {
      requests.push(request);
      const value = outputs[requests.length - 1];
      if (value instanceof LlmProviderError) throw value;
      const metadata = {
        operation: request.operation,
        provider: "replay" as const,
        transport: "replay" as const,
        adapterVersion: "test",
        requestedModel: "test",
        resolvedModel: "test",
        latencyMs: 1,
        dataRetentionMode: "no_retention" as const,
        rootRequestId: request.idempotencyKey,
        citations: [{ url: `https://example.com/${requests.length}`, title: `資料${requests.length}` }],
      };
      return { value: request.schema.parse(value), metadata, attempts: [{ output: value, metadata }] };
    },
  };
  const entry = {
    llm,
    payload: draft,
    entryRevisionId: "revision",
    ownerUserId: "owner",
  } as EntryContext;
  return { requests, run: () => understandOne(env, entry, "representation", "target", [], research) };
}

describe("character understanding completeness", () => {
  it("rejects identity-only output even when the JSON contract accepts it", () => {
    expect(understandingQualityIssues(identityOnly())).toContain(
      "人物の同定だけで、7項目のキャラクター像がすべて空です",
    );
    const candidate = identityOnly();
    candidate.summary.behavior = ["  "];
    expect(understandingQualityIssues(candidate)).not.toEqual([]);
  });

  it("keeps a partial understanding and explains unknown aspects without inventing assertions", () => {
    const candidate = known();
    expect(understandingQualityIssues(candidate)).toEqual([]);
    const displayed = explainUnknownUnderstandingAspects(candidate);
    expect(displayed.summary.behavior).toEqual(candidate.summary.behavior);
    expect(displayed.summary.goals[0]).toContain("確認できません：");
    expect(displayed.assertions).toEqual(candidate.assertions);
    expect(candidate.summary.goals).toEqual([]);
  });

  it("does not add calls when every aspect has content or a specific uncertainty", async () => {
    const { run, requests } = setup([known(), known()]);
    const result = await run();
    expect(requests).toHaveLength(2);
    expect(Object.values(result.value.summary).every((value) => value.length > 0)).toBe(true);
  });

  it("repairs an audit that erases the understanding, then audits the repair", async () => {
    const { run, requests } = setup([known(), identityOnly(), known(), known()]);
    const result = await run();
    expect(requests).toHaveLength(4);
    expect(requests[2].enableWebSearch).toBe(true);
    expect(requests[3].operation).toBe("understanding_audit");
    expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(4);
    expect(result.attempts).toHaveLength(4);
    expect(result.metadata.citations).toHaveLength(4);
    expect(result.value.summary.behavior).toEqual(known().summary.behavior);
  });

  it("stops after one repair instead of accepting an empty final audit", async () => {
    const { run, requests } = setup([identityOnly(), identityOnly(), known(), identityOnly()]);
    await expect(run()).rejects.toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      retryable: false,
      attempts: expect.any(Array),
      safeDetail: expect.stringContaining("参考情報や対象場面を追記"),
    });
    expect(requests).toHaveLength(4);
  });

  it("repairs unexplained partial gaps and keeps original-character research disabled", async () => {
    const partial = known();
    partial.uncertainties = [];
    const original = entryDraftSchema.parse({
      registrationType: "original",
      characterName: "創作人物",
      characterBasicInfo: "仲間の危機に助けに向かう",
      preference: { responseChannels: [] },
    });
    const { run, requests } = setup([partial, partial, known(), known()], original);
    await run();
    expect(requests).toHaveLength(4);
    expect(requests[2].enableWebSearch).toBe(false);
  });

  it("preserves completed call records when an audit provider fails", async () => {
    const error = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const { run } = setup([known(), error]);
    await expect(run()).rejects.toMatchObject({ code: error.code, attempts: [expect.any(Object)] });
  });
});
