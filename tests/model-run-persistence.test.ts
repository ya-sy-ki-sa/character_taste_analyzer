import { afterEach, describe, expect, it } from "vitest";
import { persistModelRun as prepareAnalysisRun } from "../worker/features/analysis/model-runs";
import { persistModelRun as persistGenerationRun } from "../worker/features/generation/model-runs";
import { sha256Hex } from "../worker/lib/crypto";
import type { LlmRunMetadata } from "../worker/llm/types";
import { testDatabase } from "./support/database";
import { seedUser } from "./support/fixtures";

const metadata: LlmRunMetadata = {
  provider: "fake",
  transport: "fake",
  adapterVersion: "1.3.0",
  requestedModel: "fixture",
  resolvedModel: "fake-v1",
  latencyMs: 12,
  dataRetentionMode: "no_retention",
  rootRequestId: "original-request",
  attemptNumber: 1,
  promptHash: "original-prompt",
  inputTokens: 10,
  outputTokens: 20,
  effectiveSettings: { understandingSchemaVersion: "1.2", understandingInformationPolicy: "audit-policy" },
  ignoredParameters: ["temperature"],
  providerResponseDiagnostics: { safetySignal: "none", responseId: "response" },
};

let current: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  current?.close();
  current = undefined;
});

describe("model run commit boundaries", () => {
  it.each(["standard", "dark"] as const)(
    "keeps the %s analysis record inside its caller's atomic batch",
    async (domain) => {
      current = testDatabase();
      seedUser(current.database);
      const output = { assertions: [] };
      const run = await prepareAnalysisRun(
        current.env,
        "owner",
        "character_understanding",
        "input",
        output,
        metadata,
        domain,
      );
      const count = () => current?.database.prepare("SELECT COUNT(*) AS count FROM model_run_metadata").get();
      expect(count()).toMatchObject({ count: 0 });
      await expect(
        current.DB.batch([run.statement, current.DB.prepare("INSERT INTO users SELECT * FROM users WHERE id='owner'")]),
      ).rejects.toThrow();
      expect(count()).toMatchObject({ count: 0 });
      await current.DB.batch([run.statement]);
      expect(current.database.prepare("SELECT * FROM model_run_metadata WHERE id=?").get(run.id)).toMatchObject({
        owner_user_id: "owner",
        analysis_domain: domain,
        operation: "character_understanding",
        prompt_version: "character_understanding/audit-policy",
        schema_version: "1.2",
        input_hash: "input",
        output_hash: await sha256Hex(JSON.stringify(output)),
        root_request_id: "original-request",
        attempt_number: 1,
        prompt_hash: "original-prompt",
        input_token_estimate: 10,
        output_token_estimate: 20,
        effective_settings_json: JSON.stringify(metadata.effectiveSettings),
        ignored_parameters_json: JSON.stringify(metadata.ignoredParameters),
        provider_response_diagnostics_json: JSON.stringify(metadata.providerResponseDiagnostics),
      });
    },
  );

  it("persists generation records immediately with their own version policy and metadata operation", async () => {
    current = testDatabase();
    seedUser(current.database);
    const id = await persistGenerationRun(
      current.env,
      "owner",
      "input",
      {},
      {
        ...metadata,
        operation: "generation_repair",
      },
      "character_generation",
      "dark",
    );
    expect(current.database.prepare("SELECT * FROM model_run_metadata WHERE id=?").get(id)).toMatchObject({
      analysis_domain: "dark",
      operation: "generation_repair",
      prompt_version: "generation_repair/v2.3.0",
      schema_version: "1.0",
    });
  });
});
