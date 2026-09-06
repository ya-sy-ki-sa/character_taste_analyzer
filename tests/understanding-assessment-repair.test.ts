import { describe, expect, it } from "vitest";
import { z } from "zod";
import { groundedUnderstandingAuditSchema } from "../shared/contracts/semantic-audit";
import { repairUnderstandingAssessments } from "../worker/features/analysis/audit-repair";
import { fakeGroundedUnderstanding } from "../worker/features/analysis/semantic-fake";
import { RemoteProvider } from "../worker/llm/remote";
import { type LlmMessage, LlmProviderError, type StructuredLlmRequest } from "../worker/llm/types";
import fixtures from "./fixtures/sparse-understanding.json";
import { frozenAudit } from "./support/understanding-audit";

class ScriptedRemote extends RemoteProvider {
  readonly providerId = "openai" as const;
  calls: Array<{ messages: LlmMessage[]; schema: string; key: string }> = [];
  constructor(private outputs: unknown[]) {
    super();
  }
  async invoke<T>(request: StructuredLlmRequest<T>, messages: LlmMessage[], key: string) {
    this.calls.push({ messages, schema: request.schemaName, key });
    const output = this.outputs.shift();
    if (output instanceof Error) throw output;
    return {
      text: JSON.stringify(output),
      metadata: {
        provider: "openai" as const,
        transport: "ai_gateway" as const,
        adapterVersion: "test",
        requestedModel: "test",
        resolvedModel: "test",
        latencyMs: 1,
        dataRetentionMode: "no_retention" as const,
      },
    };
  }
}
const valid = () => fakeGroundedUnderstanding(frozenAudit(fixtures[0]));
const request = (): StructuredLlmRequest<z.infer<typeof groundedUnderstandingAuditSchema>> => ({
  operation: "understanding_audit",
  schemaName: "grounded_audit",
  schemaVersion: "1.0",
  schema: groundedUnderstandingAuditSchema,
  jsonSchema: z.toJSONSchema(groundedUnderstandingAuditSchema),
  messages: [{ role: "user", content: "固定入力" }],
  maxOutputTokens: 20000,
  temperature: 0,
  idempotencyKey: "test",
  fakeFactory: valid,
  repairStrategy: repairUnderstandingAssessments,
});
describe("bounded assessment-only repair", () => {
  it.each(["out_of_range", "duplicate", "missing", "unknown"])(
    "repairs %s without changing the body",
    async (failure) => {
      const original = valid();
      const broken = structuredClone(original);
      const aspect = Object.keys(broken.aspectAssessments).find(
        (key) => broken.summary[key as keyof typeof broken.aspectAssessments].length,
      ) as keyof typeof broken.aspectAssessments;
      if (failure === "out_of_range") broken.aspectAssessments[aspect].summaryIndexes = [999];
      if (failure === "duplicate") broken.aspectAssessments[aspect].summaryIndexes = [0, 0];
      if (failure === "missing") broken.aspectAssessments[aspect].summaryIndexes = [];
      if (failure === "unknown") broken.aspectAssessments[aspect].kind = "unknown";
      const provider = new ScriptedRemote([broken, { aspectAssessments: original.aspectAssessments }]);
      const result = await provider.generateStructured(request());
      expect(result.value).toEqual(original);
      expect(provider.calls.map((call) => call.schema)).toEqual(["grounded_audit", "understanding_assessments_repair"]);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts?.[0].metadata.promptHash).not.toBe(result.metadata.promptHash);
      expect(result.metadata.effectiveSettings?.actualSchemaHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.attempts?.[0].metadata.effectiveSettings?.actualSchemaHash).not.toBe(
        result.metadata.effectiveSettings?.actualSchemaHash,
      );
      expect(result.metadata.effectiveSettings).toMatchObject({ repairKind: "understanding_assessments" });
    },
  );
  it("keeps long numbered content intact in repair input", async () => {
    const original = valid();
    original.assertions = Array.from({ length: 15 }, (_, index) => ({
      ...original.assertions[0],
      valueText: `人物描写${index}${"長文".repeat(200)}`,
    }));
    const broken = structuredClone(original);
    broken.aspectAssessments.narrativeRole.summaryIndexes = [999];
    const provider = new ScriptedRemote([broken, { aspectAssessments: original.aspectAssessments }]);
    expect((await provider.generateStructured(request())).value.assertions).toEqual(original.assertions);
    const content = provider.calls[1].messages.map((item) => item.content).join("\n");
    expect(content.length).toBeGreaterThan(8000);
    expect(content).toContain(original.assertions[14].valueText);
  });
  it("rejects malicious repair output that also changes the frozen body", async () => {
    const broken = valid();
    broken.aspectAssessments.narrativeRole.summaryIndexes = [999];
    const provider = new ScriptedRemote([broken, { aspectAssessments: valid().aspectAssessments, assertions: [] }]);
    await expect(provider.generateStructured(request())).rejects.toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      retryable: false,
    });
    expect(provider.calls).toHaveLength(2);
  });
  it("stops after the one repair when references remain invalid", async () => {
    const broken = valid();
    broken.aspectAssessments.narrativeRole.summaryIndexes = [999];
    const provider = new ScriptedRemote([broken, { aspectAssessments: broken.aspectAssessments }]);
    await expect(provider.generateStructured(request())).rejects.toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      attempts: [expect.anything(), expect.anything()],
    });
    expect(provider.calls).toHaveLength(2);
  });
  it("uses the existing full repair for invalid character content", async () => {
    const broken = { ...valid(), summary: null };
    const provider = new ScriptedRemote([broken, valid()]);
    await provider.generateStructured(request());
    expect(provider.calls[1].schema).toBe("grounded_audit");
  });
  it("preserves failure records when the repair provider fails", async () => {
    const broken = valid();
    broken.aspectAssessments.narrativeRole.summaryIndexes = [999];
    const provider = new ScriptedRemote([
      broken,
      new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true),
    ]);
    await expect(provider.generateStructured(request())).rejects.toMatchObject({
      code: "EXTERNAL_PROVIDER_UNAVAILABLE",
      attempts: [expect.anything()],
    });
  });
});
