import { expect, it, vi } from "vitest";
import { generationRequestInputSchema } from "../shared/contracts/generation";
import { processGeneration } from "../worker/features/generation/process";
import { createGenerationRequest } from "../worker/features/generation/request";
import * as similarity from "../worker/features/generation/similarity";
import { claimJob } from "../worker/features/jobs/execution";
import * as execution from "../worker/llm/execution";
import { createLlmProvider } from "../worker/llm/providers";
import { LlmProviderError, type StructuredLlmRequest } from "../worker/llm/types";
import { rebuild, setup } from "./support/preference-pipeline";

async function newGeneration(domain: "standard" | "dark") {
  const t = await setup(domain);
  const profile = await rebuild(t, domain);
  if (!profile) throw new Error("Missing fixture profile");
  const ids = t.db.database
    .prepare(
      "SELECT id FROM profile_snapshot_items WHERE profile_snapshot_id=? AND item_type='dimension' ORDER BY ordinal LIMIT 2",
    )
    .all(profile.profileSnapshotId)
    .map((row) => String(row.id));
  const created = await createGenerationRequest(
    t.env,
    t.owner,
    domain,
    generationRequestInputSchema.parse({
      profileSnapshotId: profile.profileSnapshotId,
      mode: "balanced",
      purpose: "offline resilience test",
      selectedItemIds: ids,
    }),
    crypto.randomUUID(),
  );
  const params = {
    jobId: created.jobId as string,
    generationRequestId: created.generationRequestId,
    ownerUserId: t.owner,
    inputGeneration: 1,
    analysisDomain: domain,
  };
  const calls: StructuredLlmRequest<unknown>[] = [];
  const provider = createLlmProvider(t.env);
  const invoke = vi.fn(async (request: StructuredLlmRequest<unknown>) => {
    calls.push(request);
    return provider.generateStructured(request);
  });
  vi.spyOn(execution, "createJobLlmProvider").mockResolvedValue({
    providerId: "fake",
    async generateStructured<T>(request: StructuredLlmRequest<T>) {
      const result = await invoke(request);
      return { ...result, value: request.schema.parse(result.value) };
    },
  });
  return { ...t, params, calls, invoke, provider };
}
async function reclaim(t: Awaited<ReturnType<typeof newGeneration>>) {
  t.db.database
    .prepare("UPDATE job_attempts SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=? AND status='running'")
    .run(t.params.jobId);
  const next = await claimJob(t.env, t.params.jobId, t.owner, 1, "character-generation");
  expect(next.status).toBe("claimed");
  if (next.status !== "claimed") throw new Error("Reclaim failed");
  return next.attemptId;
}
function job(t: Awaited<ReturnType<typeof newGeneration>>) {
  return t.db.database.prepare("SELECT status,error_code,current_step FROM jobs WHERE id=?").get(t.params.jobId);
}
function characterCount(t: Awaited<ReturnType<typeof newGeneration>>) {
  return t.db.database
    .prepare("SELECT COUNT(*) AS count FROM generated_characters WHERE generation_request_id=?")
    .get(t.params.generationRequestId)?.count;
}
const isGeneration = (request: StructuredLlmRequest<unknown>) =>
  ["character_generation", "dark_character_generation"].includes(request.operation);

for (const domain of ["standard", "dark"] as const) {
  it(`${domain}: comparison failure reuses all three validated candidates and the same brief`, async () => {
    const t = await newGeneration(domain);
    let fail = true;
    t.invoke.mockImplementation(async (request) => {
      t.calls.push(request);
      if (request.operation === "generation_comparison" && fail) {
        fail = false;
        throw new LlmProviderError("injected", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
      }
      return t.provider.generateStructured(request);
    });
    await expect(processGeneration(t.env, t.params)).rejects.toMatchObject({ code: "EXTERNAL_PROVIDER_UNAVAILABLE" });
    expect(
      t.db.database
        .prepare(
          "SELECT COUNT(*) AS count FROM generation_candidates WHERE generation_request_id=? AND status='passed'",
        )
        .get(t.params.generationRequestId)?.count,
    ).toBe(3);
    const initial = t.calls.length;
    expect(initial).toBe(7);
    await processGeneration(t.env, t.params);
    const resumed = t.calls.slice(initial);
    expect(resumed.map((request) => request.operation)).toEqual(["generation_comparison"]);
    expect(resumed[0].idempotencyKey).toBe(t.calls[initial - 1].idempotencyKey);
    expect(
      t.db.database
        .prepare("SELECT COUNT(*) AS count FROM generation_briefs WHERE generation_request_id=?")
        .get(t.params.generationRequestId)?.count,
    ).toBe(1);
    expect(job(t)?.status).toBe("succeeded");
    expect(characterCount(t)).toBe(1);
  });

  it(`${domain}: a later candidate failure preserves earlier completed inspections`, async () => {
    const t = await newGeneration(domain);
    let generationCalls = 0;
    t.invoke.mockImplementation(async (request) => {
      t.calls.push(request);
      if (isGeneration(request) && ++generationCalls === 2)
        throw new LlmProviderError("injected", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
      return t.provider.generateStructured(request);
    });
    await expect(processGeneration(t.env, t.params)).rejects.toMatchObject({ code: "EXTERNAL_PROVIDER_UNAVAILABLE" });
    const first = t.calls.length;
    expect(
      t.db.database
        .prepare("SELECT ordinal FROM generation_candidates WHERE generation_request_id=?")
        .all(t.params.generationRequestId),
    ).toEqual([{ ordinal: 1 }]);
    await processGeneration(t.env, t.params);
    expect(t.calls.slice(first).filter(isGeneration)).toHaveLength(2);
    expect(t.calls.slice(first)).toHaveLength(5);
    expect(job(t)?.status).toBe("succeeded");
  });

  it(`${domain}: candidates from another prompt version are regenerated`, async () => {
    const t = await newGeneration(domain);
    let fail = true;
    t.invoke.mockImplementation(async (request) => {
      t.calls.push(request);
      if (request.operation === "generation_comparison" && fail) {
        fail = false;
        throw new LlmProviderError("injected", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
      }
      return t.provider.generateStructured(request);
    });
    await expect(processGeneration(t.env, t.params)).rejects.toThrow("injected");
    t.db.database
      .prepare(
        "UPDATE model_run_metadata SET prompt_version='old-version' WHERE id=(SELECT model_run_metadata_id FROM generation_candidates WHERE generation_request_id=? AND ordinal=2)",
      )
      .run(t.params.generationRequestId);
    const first = t.calls.length;
    await processGeneration(t.env, t.params);
    expect(t.calls.slice(first).filter(isGeneration)).toHaveLength(1);
    expect(t.calls.slice(first).filter((request) => request.operation === "generation_validation")).toHaveLength(1);
    expect(job(t)?.status).toBe("succeeded");
  });

  it(`${domain}: saved candidates are rechecked against the current similarity corpus`, async () => {
    const t = await newGeneration(domain);
    let fail = true;
    t.invoke.mockImplementation(async (request) => {
      t.calls.push(request);
      if (request.operation === "generation_comparison" && fail) {
        fail = false;
        throw new LlmProviderError("injected", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
      }
      return t.provider.generateStructured(request);
    });
    await expect(processGeneration(t.env, t.params)).rejects.toThrow("injected");
    const stored = t.db.database
      .prepare("SELECT character_json FROM generation_candidates WHERE generation_request_id=? AND ordinal=1")
      .get(t.params.generationRequestId);
    const candidate = JSON.parse(String(stored?.character_json)) as { identity: { name: string } };
    vi.spyOn(similarity, "loadSimilarityDocuments").mockResolvedValueOnce([
      { id: "entry:new", name: candidate.identity.name, text: "Newly registered character" },
    ]);
    const first = t.calls.length;
    await processGeneration(t.env, t.params);
    expect(t.calls.slice(first).filter(isGeneration)).toHaveLength(1);
    expect(t.calls.slice(first).filter((request) => request.operation === "generation_repair")).toHaveLength(1);
    expect(t.calls.at(-1)?.idempotencyKey).not.toBe(t.calls[first - 1].idempotencyKey);
    expect(
      t.db.database
        .prepare("SELECT status FROM generation_candidates WHERE generation_request_id=? AND ordinal=1")
        .get(t.params.generationRequestId)?.status,
    ).toBe("failed");
    expect(job(t)?.status).toBe("succeeded");
    expect(characterCount(t)).toBe(1);
  });

  it(`${domain}: exhausting attempts marks the request and job failed without calling a model`, async () => {
    const t = await newGeneration(domain);
    for (let number = 1; number <= 3; number++)
      t.db.database
        .prepare(
          "INSERT INTO job_attempts (id,job_id,attempt_number,step_name,status,started_at) VALUES (?,?,?,'character-generation','failed',?)",
        )
        .run(crypto.randomUUID(), t.params.jobId, number, new Date().toISOString());
    await processGeneration(t.env, t.params);
    expect(job(t)).toMatchObject({ status: "failed", error_code: "JOB_STEP_ATTEMPTS_EXHAUSTED" });
    expect(
      t.db.database.prepare("SELECT status FROM generation_requests WHERE id=?").get(t.params.generationRequestId)
        ?.status,
    ).toBe("failed");
    expect(t.calls).toHaveLength(0);
    expect(characterCount(t)).toBe(0);
  });

  it.each([false, true])(
    `${domain}: obsolete model completion cannot change the current attempt (failure=%s)`,
    async (fail) => {
      const t = await newGeneration(domain);
      let currentAttempt = "";
      t.invoke.mockImplementationOnce(async (request) => {
        t.calls.push(request);
        currentAttempt = await reclaim(t);
        if (fail) throw new LlmProviderError("obsolete failure", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
        return t.provider.generateStructured(request);
      });
      await processGeneration(t.env, t.params);
      expect(job(t)).toMatchObject({ status: "running", error_code: null, current_step: "character-generation" });
      expect(t.db.database.prepare("SELECT status FROM job_attempts WHERE id=?").get(currentAttempt)?.status).toBe(
        "running",
      );
      expect(characterCount(t)).toBe(0);
      expect(t.calls).toHaveLength(1);
      expect(
        t.db.database
          .prepare("SELECT COUNT(*) AS count FROM generation_candidates WHERE generation_request_id=?")
          .get(t.params.generationRequestId)?.count,
      ).toBe(0);
    },
  );

  it(`${domain}: losing the attempt immediately before commit makes every result write a no-op`, async () => {
    const t = await newGeneration(domain);
    const original = t.env.DB.batch.bind(t.env.DB);
    let currentAttempt = "";
    vi.spyOn(t.env.DB, "batch").mockImplementation(async (statements) => {
      if (
        !currentAttempt &&
        (statements[0] as unknown as { sql: string }).sql.includes("INSERT INTO generated_characters")
      )
        currentAttempt = await reclaim(t);
      return original(statements);
    });
    await processGeneration(t.env, t.params);
    expect(currentAttempt).not.toBe("");
    expect(job(t)?.status).toBe("running");
    expect(characterCount(t)).toBe(0);
    expect(t.db.database.prepare("SELECT status FROM job_attempts WHERE id=?").get(currentAttempt)?.status).toBe(
      "running",
    );
    expect(
      t.db.database
        .prepare("SELECT DISTINCT comparison_json FROM generation_candidates WHERE generation_request_id=?")
        .all(t.params.generationRequestId),
    ).toEqual([{ comparison_json: "{}" }]);
  });

  it(`${domain}: a replacement just before failure persistence cannot be marked failed`, async () => {
    const t = await newGeneration(domain);
    t.invoke.mockRejectedValueOnce(new LlmProviderError("injected", "EXTERNAL_PROVIDER_UNAVAILABLE", true));
    const original = t.env.DB.batch.bind(t.env.DB);
    let currentAttempt = "";
    vi.spyOn(t.env.DB, "batch").mockImplementation(async (statements) => {
      if (
        !currentAttempt &&
        (statements[0] as unknown as { sql: string }).sql.includes("UPDATE generation_requests SET status=?")
      )
        currentAttempt = await reclaim(t);
      return original(statements);
    });
    await processGeneration(t.env, t.params);
    expect(currentAttempt).not.toBe("");
    expect(job(t)).toMatchObject({ status: "running", error_code: null });
    expect(t.db.database.prepare("SELECT status FROM job_attempts WHERE id=?").get(currentAttempt)?.status).toBe(
      "running",
    );
  });

  it(`${domain}: a failed final batch rolls back results and keeps candidate checkpoints`, async () => {
    const t = await newGeneration(domain);
    t.db.database.exec(
      "CREATE TRIGGER fail_basis BEFORE INSERT ON generation_basis_links BEGIN SELECT RAISE(ABORT,'injected final failure'); END;",
    );
    await processGeneration(t.env, t.params);
    expect(job(t)?.status).toBe("failed");
    expect(characterCount(t)).toBe(0);
    expect(
      t.db.database
        .prepare("SELECT COUNT(*) AS count FROM generation_candidates WHERE generation_request_id=?")
        .get(t.params.generationRequestId)?.count,
    ).toBe(3);
    expect(
      t.db.database
        .prepare("SELECT DISTINCT comparison_json FROM generation_candidates WHERE generation_request_id=?")
        .all(t.params.generationRequestId),
    ).toEqual([{ comparison_json: "{}" }]);
    expect(t.db.database.prepare("SELECT status FROM job_attempts WHERE job_id=?").all(t.params.jobId)).toEqual([
      { status: "failed" },
    ]);
  });
}
