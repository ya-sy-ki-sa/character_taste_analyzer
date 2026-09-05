import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalysisDomain, apiPrefixForDomain } from "../shared/analysis-domain";
import { app } from "../worker/app";
import { LOCAL_SESSION_COOKIE } from "../worker/lib/cookies";
import { hmacHex, sha256Hex } from "../worker/lib/crypto";
import { createModerationProvider } from "../worker/moderation/providers";
import { ModerationProviderError } from "../worker/moderation/types";
import { dispatchOutboxEvent, dispatchPendingProfileRebuild } from "../worker/runtime/outbox";

import type { Env } from "../worker/types";

vi.mock("../worker/moderation/providers", () => ({ createModerationProvider: vi.fn() }));
vi.mock("../worker/runtime/outbox", () => ({
  dispatchOutboxEvent: vi.fn(),
  dispatchPendingProfileRebuild: vi.fn(),
}));

const origin = "https://lab.example";
const ownerId = "00000000-0000-4000-8000-000000000001";
const resourceId = "00000000-0000-4000-8000-000000000002";
const key = "00000000-0000-4000-8000-000000000003";
const sessionToken = "test-session-token";
const moderate = vi.fn();
const store = vi.hoisted(() => ({
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  createEntryReanalysis: vi.fn(),
  archiveEntry: vi.fn(),
  confirmUnderstanding: vi.fn(),
  activateAnalysisAndRebuild: vi.fn(),
  loadCurrentProfile: vi.fn(),
  loadProjectionFreshness: vi.fn(),
  loadCurrentGraph: vi.fn(),
  listGenerations: vi.fn(),
  deleteGeneration: vi.fn(),
  createGenerationRequest: vi.fn(),
  selectGenerationCandidate: vi.fn(),
  createGenerationFeedback: vi.fn(),
  listGenerationFeedback: vi.fn(),
  reviewGenerationFeedback: vi.fn(),
  refinePreferenceInput: vi.fn(),
  loadJob: vi.fn(),
  retryGeneration: vi.fn(),
  retryCharacterAnalysis: vi.fn(),
}));
const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
let env: Env;
let csrfToken: string;

beforeEach(async () => {
  vi.resetAllMocks();
  const pepper = "api-route-test-pepper";
  csrfToken = await hmacHex(pepper, `csrf\u0000${sessionToken}`);
  const csrfDigest = await sha256Hex(csrfToken);
  const tokenDigest = await sha256Hex(sessionToken);
  // Exercise the real session, rate-limit and CSRF middleware with a small D1 test double.
  env = {
    ENVIRONMENT: "local",
    APP_ORIGIN: origin,
    AUTH_PEPPER: pepper,
    DB: {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM sessions")) {
              return bindings[0] === tokenDigest
                ? {
                    id: "session-id",
                    user_id: ownerId,
                    username: "観測者",
                    membership_tier: "basic",
                    csrf_digest: csrfDigest,
                    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
                  }
                : null;
            }
            if (sql.includes("request_rate_limits")) return { count: 1 };
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      }),
    },
  } as unknown as Env;
  vi.mocked(createModerationProvider).mockReturnValue({ providerId: "test", moderate });
  moderate.mockResolvedValue({ allowed: true, reasons: [] });
  vi.mocked(dispatchOutboxEvent).mockResolvedValue(true);
  vi.mocked(dispatchPendingProfileRebuild).mockResolvedValue(true);
});

function request(path: string, method = "GET", body?: unknown, overrides: Record<string, string | null> = {}) {
  const headers = new Headers({
    Cookie: `${LOCAL_SESSION_COOKIE}=${sessionToken}`,
    Origin: origin,
    "X-CSRF-Token": csrfToken,
    "Idempotency-Key": key,
    "Content-Type": "application/json",
    "CF-Ray": "test-request-id",
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return app.request(
    `${origin}${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
    executionCtx,
  );
}

function draft(domain: AnalysisDomain) {
  return {
    registrationType: "original",
    characterName: "観測対象",
    characterBasicInfo: "物語に登場する人物",
    preference: { likedReasons: "生き方に惹かれる" },
    ...(domain === "dark" ? { darkContext: { focusDescription: "敵対する人物" } } : {}),
  };
}

describe.each(["standard", "dark"] as const)("%s API routes", (domain) => {
  const prefix = apiPrefixForDomain(domain);

  it("routes quality actions with the authenticated owner, domain and explicit review", async () => {
    store.selectGenerationCandidate.mockResolvedValue({ candidateId: resourceId, generatedCharacterId: resourceId });
    expect(
      (await request(`${prefix}/generation-requests/${resourceId}/selection`, "POST", { candidateId: resourceId }))
        .status,
    ).toBe(200);
    expect(store.selectGenerationCandidate).toHaveBeenCalledWith(env, ownerId, domain, resourceId, resourceId);
    store.createGenerationFeedback.mockResolvedValue({ id: resourceId, replayed: false });
    const feedback = {
      candidateId: resourceId,
      outputPointer: "/personality/summary",
      reason: "物語として面白い",
      attributeStableKey: "test.attribute",
      polarity: "positive",
      responseChannel: domain === "dark" ? "dark_curiosity" : "narrative_interest",
      scope: "敵対時のみ",
    };
    expect((await request(`${prefix}/generation-feedback`, "POST", feedback)).status).toBe(200);
    expect(store.createGenerationFeedback).toHaveBeenCalledWith(env, ownerId, domain, feedback, key);
    expect(store.reviewGenerationFeedback).not.toHaveBeenCalled();
    store.reviewGenerationFeedback.mockResolvedValue({ status: "confirmed", outboxEventId: "feedback-profile-event" });
    expect(
      (await request(`${prefix}/generation-feedback/${resourceId}/review`, "POST", { decision: "confirm" })).status,
    ).toBe(200);
    expect(store.reviewGenerationFeedback).toHaveBeenCalledWith(env, ownerId, domain, resourceId, "confirm");
    expect(dispatchOutboxEvent).toHaveBeenCalledWith(env, "feedback-profile-event");
    store.refinePreferenceInput.mockResolvedValue({
      id: resourceId,
      replayed: false,
      outboxEventId: "refinement-event",
    });
    expect(
      (await request(`${prefix}/entries/${resourceId}/preference-input`, "POST", { mode: "hypotheses" })).status,
    ).toBe(202);
    expect(store.refinePreferenceInput).toHaveBeenCalledWith(
      env,
      ownerId,
      domain,
      resourceId,
      { mode: "hypotheses" },
      key,
    );
    expect(dispatchOutboxEvent).toHaveBeenCalledWith(env, "refinement-event");
    const selection = {
      mode: "selection",
      hypothesisBatchId: crypto.randomUUID(),
      selectedHypothesisIds: [crypto.randomUUID()],
    };
    expect((await request(`${prefix}/entries/${resourceId}/preference-input`, "POST", selection)).status).toBe(202);
    expect(store.refinePreferenceInput).toHaveBeenLastCalledWith(env, ownerId, domain, resourceId, selection, key);
  });
  it("rejects incomplete quality input before writing", async () => {
    expect((await request(`${prefix}/generation-feedback`, "POST", { reason: "不足" })).status).toBe(400);
    expect(
      (await request(`${prefix}/entries/${resourceId}/preference-input`, "POST", { mode: "questions", answers: [] }))
        .status,
    ).toBe(400);
    expect(store.createGenerationFeedback).not.toHaveBeenCalled();
    expect(store.refinePreferenceInput).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner and the mounted domain", async () => {
    const entry = {
      id: resourceId,
      registrationType: "original",
      status: "active",
      title: "登録",
      subtitle: "",
      activeRevisionNumber: 1,
      updatedAt: "2026-09-05T00:00:00.000Z",
      reviewTargetId: null,
      job: null,
    };
    store.listEntries.mockResolvedValue([entry]);
    const response = await request(`${prefix}/entries`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { entries: [entry] } });
    expect(store.listEntries).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain);
  });

  it.each([null, `${LOCAL_SESSION_COOKIE}=invalid-token`])("requires a valid session (%s)", async (cookie) => {
    const response = await request(`${prefix}/entries`, "GET", undefined, { Cookie: cookie });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_REQUIRED", requestId: "test-request-id" } });
    expect(Object.values(store).some((method) => method.mock.calls.length > 0)).toBe(false);
    expect(response.headers.get("X-Request-Id")).toBe("test-request-id");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it.each([
    ["Origin", null, "ORIGIN_REQUIRED"],
    ["Origin", "https://untrusted.example", "ORIGIN_DENIED"],
    ["X-CSRF-Token", null, "REQUEST_INVALID"],
  ] as const)("keeps write protection for %s=%s", async (header, value, code) => {
    const response = await request(`${prefix}/entries`, "POST", draft(domain), { [header]: value });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(moderate).not.toHaveBeenCalled();
    expect(Object.values(store).some((method) => method.mock.calls.length > 0)).toBe(false);
  });

  it("rejects bodies above 64 KiB before input processing", async () => {
    const response = await request(`${prefix}/entries`, "POST", { text: "x".repeat(65_536) });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } });
    expect(moderate).not.toHaveBeenCalled();
  });

  it.each([false, true])("dispatches committed entry events only for new requests (replayed=%s)", async (replayed) => {
    const result = {
      entryId: resourceId,
      jobId: resourceId,
      status: "submitted",
      replayed,
      outboxEventId: "analysis",
      profileOutboxEventId: "profile",
    };
    store.createEntry.mockResolvedValue(result);
    const response = await request(`${prefix}/entries`, "POST", draft(domain));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: result });
    expect(store.createEntry).toHaveBeenCalledExactlyOnceWith(
      env,
      ownerId,
      domain,
      expect.objectContaining({ preference: expect.objectContaining({ responseChannels: [] }) }),
      key,
    );
    expect(moderate).toHaveBeenCalledOnce();
    expect(vi.mocked(dispatchOutboxEvent).mock.calls.map((call) => call[1])).toEqual(
      replayed ? [] : ["analysis", "profile"],
    );
    expect(executionCtx.waitUntil).toHaveBeenCalledTimes(replayed ? 0 : 2);
  });

  it.each(["/entries", `/entries/${resourceId}/reanalysis`])("keeps domain-specific validation at %s", async (path) => {
    const incompatible = draft(domain === "dark" ? "standard" : "dark");
    const body = path.endsWith("reanalysis") ? { draft: incompatible } : incompatible;
    const response = await request(`${prefix}${path}`, "POST", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", details: expect.any(Array) } });
    expect(moderate).not.toHaveBeenCalled();
    expect(Object.values(store).some((method) => method.mock.calls.length > 0)).toBe(false);
  });

  it("requires UUID idempotency keys before saving an entry", async () => {
    const response = await request(`${prefix}/entries`, "POST", draft(domain), { "Idempotency-Key": "invalid" });
    expect(response.status).toBe(400);
    expect(store.createEntry).not.toHaveBeenCalled();
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
  });

  it("stops rejected inputs before persistence or dispatch", async () => {
    moderate.mockResolvedValue({
      allowed: false,
      reasons: [{ field: "好きな理由", category: "violence", label: "暴力的な内容" }],
    });
    const response = await request(`${prefix}/entries`, "POST", draft(domain));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("好きな理由：暴力的な内容") },
    });
    expect(Object.values(store).some((method) => method.mock.calls.length > 0)).toBe(false);
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["understanding-snapshots", "confirmUnderstanding", "analyzing"],
    ["preference-analysis-runs", "activateAnalysisAndRebuild", "active"],
  ] as const)("checks review target identity for %s", async (path, method, status) => {
    store[method].mockResolvedValue({
      entryId: resourceId,
      jobId: "job",
      profileJobId: "profile-job",
      outboxEventId: "review",
      freshness: { status: "rebuilding", desiredGeneration: 2, builtGeneration: 1 },
    });
    const url = `${prefix}/${path}/${resourceId}/review`;
    const invalid = await request(url, "POST", { decision: "confirm_all", targetIds: [ownerId] });
    expect(invalid.status).toBe(422);
    expect(store[method]).not.toHaveBeenCalled();
    const response = await request(url, "POST", { decision: "confirm_all", targetIds: [resourceId] });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { status } });
    expect(store[method]).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain, resourceId);
    expect(dispatchOutboxEvent).toHaveBeenCalledExactlyOnceWith(env, "review");
  });

  it("preserves graph response fields and defaults invalid detail to standard", async () => {
    const graph = {
      schemaVersion: "1.0",
      projectionId: resourceId,
      profileGeneration: 1,
      contentHash: "hash",
      detail: "standard",
      nodes: [],
      edges: [],
      truncated: false,
      truncationReason: null,
    };
    const freshness = { status: "fresh", desiredGeneration: 1, builtGeneration: 1, errorCode: null };
    store.loadCurrentGraph.mockResolvedValue(graph);
    store.loadProjectionFreshness.mockResolvedValue(freshness);
    const response = await request(`${prefix}/profile/graph?detail=invalid`);
    expect(await response.json()).toEqual({ data: { graph, freshness } });
    expect(store.loadCurrentGraph).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain, "standard");
    expect(store.loadProjectionFreshness).toHaveBeenCalledTimes(1);
  });

  it("dispatches an already queued profile rebuild", async () => {
    store.loadCurrentProfile.mockResolvedValue(null);
    store.loadProjectionFreshness.mockResolvedValue({
      status: "rebuilding",
      desiredGeneration: 2,
      builtGeneration: 1,
      errorCode: null,
    });
    const response = await request(`${prefix}/profile`);
    expect(response.status).toBe(200);
    expect(store.loadCurrentProfile).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain);
    expect(dispatchPendingProfileRebuild).toHaveBeenCalledTimes(1);
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
  });

  it("uses the same generation request paths and deletion status in both domains", async () => {
    store.listGenerations.mockResolvedValue([]);
    const listPath = "/generation-requests";
    const deletePath = "/generation-requests";
    expect(await (await request(`${prefix}${listPath}`)).json()).toEqual({ data: { generations: [] } });
    const response = await request(`${prefix}${deletePath}/${resourceId}`, "DELETE");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(store.listGenerations).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain);
    expect(store.deleteGeneration).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain, resourceId);
  });

  it.each([
    ["generation", "retryGeneration"],
    ["character_analysis", "retryCharacterAnalysis"],
  ] as const)("retries %s jobs in the mounted domain", async (jobType, method) => {
    store.loadJob.mockResolvedValue({ job_type: jobType });
    store[method].mockResolvedValue({
      jobId: resourceId,
      outboxEventId: "retry",
      inputGeneration: 1,
      ...(jobType === "generation"
        ? { generationRequestId: resourceId }
        : { entryId: resourceId, stage: "understanding" }),
    });
    const response = await request(`${prefix}/jobs/${resourceId}/retry`, "POST");
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { jobId: resourceId, status: "queued" } });
    expect(store.loadJob).toHaveBeenCalledExactlyOnceWith(env, ownerId, domain, resourceId);
    expect(store[method]).toHaveBeenCalledExactlyOnceWith(env, ownerId, resourceId, key);
    expect(dispatchOutboxEvent).toHaveBeenCalledExactlyOnceWith(env, "retry");
  });

  it("does not retry a job outside the owner or domain", async () => {
    store.loadJob.mockResolvedValue(null);
    const response = await request(`${prefix}/jobs/${resourceId}/retry`, "POST");
    expect(response.status).toBe(404);
    expect(store.retryGeneration).not.toHaveBeenCalled();
    expect(store.retryCharacterAnalysis).not.toHaveBeenCalled();
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
  });

  it("maps service errors through the shared error handler", async () => {
    store.archiveEntry.mockRejectedValue(new Error("ENTRY_REVISION_CONFLICT"));
    const response = await request(`${prefix}/entries/${resourceId}`, "DELETE");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "ENTRY_REVISION_CONFLICT", requestId: "test-request-id" },
    });
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
  });

  it("preserves moderation provider failure responses on generation requests", async () => {
    moderate.mockRejectedValue(new ModerationProviderError("unavailable", "MODERATION_PROVIDER_UNAVAILABLE"));
    const response = await request(`${prefix}/generation-requests`, "POST", {
      purpose: "物語",
      profileSnapshotId: resourceId,
      selectedItemIds: [resourceId],
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "MODERATION_PROVIDER_UNAVAILABLE" } });
    expect(store.createGenerationRequest).not.toHaveBeenCalled();
  });
});

vi.mock("../worker/features/entries/list", () => ({ listEntries: store.listEntries }));
vi.mock("../worker/features/entries/create", () => ({ createEntry: store.createEntry }));
vi.mock("../worker/features/entries/reanalysis", () => ({ createEntryReanalysis: store.createEntryReanalysis }));
vi.mock("../worker/features/entries/archive", () => ({ archiveEntry: store.archiveEntry }));
vi.mock("../worker/features/entries/understanding-review", () => ({
  confirmUnderstanding: store.confirmUnderstanding,
}));
vi.mock("../worker/features/analysis/activation", () => ({
  activateAnalysisAndRebuild: store.activateAnalysisAndRebuild,
}));
vi.mock("../worker/features/profile/projection", () => ({
  loadCurrentProfile: store.loadCurrentProfile,
  loadProjectionFreshness: store.loadProjectionFreshness,
}));
vi.mock("../worker/features/profile/graph", () => ({ loadCurrentGraph: store.loadCurrentGraph }));
vi.mock("../worker/features/generation/history", () => ({ listGenerations: store.listGenerations }));
vi.mock("../worker/features/generation/delete", () => ({ deleteGeneration: store.deleteGeneration }));
vi.mock("../worker/features/generation/request", () => ({ createGenerationRequest: store.createGenerationRequest }));
vi.mock("../worker/features/generation/feedback", () => ({
  selectGenerationCandidate: store.selectGenerationCandidate,
  createGenerationFeedback: store.createGenerationFeedback,
  listGenerationFeedback: store.listGenerationFeedback,
  reviewGenerationFeedback: store.reviewGenerationFeedback,
}));
vi.mock("../worker/features/entries/refinement", () => ({ refinePreferenceInput: store.refinePreferenceInput }));
vi.mock("../worker/features/jobs/queries", () => ({ loadJob: store.loadJob }));
vi.mock("../worker/features/generation/retry", () => ({ retryGeneration: store.retryGeneration }));
vi.mock("../worker/features/analysis/retries", () => ({ retryCharacterAnalysis: store.retryCharacterAnalysis }));

it.each(["/api/v1/generated-characters", "/api/v1/dark/generations"])(
  "does not keep the removed generation URL %s",
  async (path) => {
    expect((await request(path)).status).toBe(404);
  },
);
