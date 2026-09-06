import { describe, expect, it } from "vitest";
import type { EvidenceReference } from "../shared/contracts/evidence";
import { normalizeUnderstanding } from "../worker/features/analysis/normalize-understanding";
import { fakeGroundedUnderstanding, fakeSemanticFields } from "../worker/features/analysis/semantic-fake";
import { verifySemanticAssertion } from "../worker/features/analysis/semantic-integrity";
import { CitationRegistry } from "../worker/platform/provenance/registry";
import type { ProvenanceSource } from "../worker/platform/provenance/verifier";
import sparseFixtures from "./fixtures/sparse-understanding.json";
import { frozenAudit } from "./support/understanding-audit";

const pointer = "/preference/likedReasons";
const input: EvidenceReference = {
  sourceRef: `input:${pointer}`,
  inputPointer: pointer,
  sourceUrl: null,
  quote: "ヒューズの妻子",
  inferenceType: "direct",
};
const model: EvidenceReference = {
  sourceRef: "model_knowledge",
  sourceUrl: null,
  inputPointer: null,
  quote: null,
  inferenceType: "inferred",
};
const invalid: EvidenceReference = {
  sourceRef: "external:missing",
  sourceUrl: null,
  inputPointer: null,
  quote: "役割の説明",
  inferenceType: "direct",
};
const sources: ProvenanceSource[] = [
  {
    sourceId: "input",
    origin: "user_input",
    inputPointer: pointer,
    text: "ヒューズの妻子が登場する場面が好き。",
    url: null,
  },
];
const assertion = (evidence = [input]) => ({
  confidence: 0.94,
  explicitness: "user_explicit",
  ...fakeSemanticFields({ evidence }),
});
const verify = (item = assertion(), character = false, provenance = sources) =>
  verifySemanticAssertion(
    item,
    provenance,
    new Set(),
    new CitationRegistry(),
    { targetType: character ? "character_assertion" : "preference_assertion", targetId: "test", modelRunId: "run" },
    [],
  );

describe("semantic and physical evidence normalization", () => {
  it("retains explicit preferences without requiring a response channel", async () => {
    expect(await verify()).toMatchObject({ keep: true, confidence: 0.94, explicitness: "user_explicit" });
  });
  it.each(["partial", "unsupported", "contradicted", "unverifiable"] as const)(
    "does not adopt a literal quote whose semantic verdict is %s",
    async (verdict) => {
      const item = assertion();
      item.evidence[0].supportAssessment.verdict = verdict;
      const result = await verify(item);
      expect(result).toMatchObject({ keep: false, confidence: 0, evidence: [] });
      expect(result.audit.evidence[0].verification.verificationStatus).toBe("verified_quote");
    },
  );
  it.each(["mismatch", "uncertain"] as const)("holds an unresolved scope: %s", async (verdict) => {
    const item = assertion();
    item.scopeAssessment.verdict = verdict;
    expect(await verify(item)).toMatchObject({ keep: false, confidence: 0 });
  });
  it("cannot override a failed quote match with a supported verdict", async () => {
    const item = assertion([{ ...input, quote: "ロイの妻子" }]);
    expect(await verify(item)).toMatchObject({
      keep: false,
      confidence: 0,
      evidence: [expect.objectContaining({ verificationStatus: "invalid" })],
    });
  });
  it("cannot fabricate a scope anchor", async () => {
    const item = assertion();
    item.scopeAssessment.anchors = [{ ...input, quote: "本人への恋愛感情はない" }];
    expect(await verify(item)).toMatchObject({ keep: false });
  });
  it("caps explicitly separate model knowledge when invalid citations remain (C02/C14)", async () => {
    const item = assertion([invalid, model]);
    item.explicitness = "source_explicit";
    item.scopeAssessment.anchors = [];
    const result = await verify(item, true);
    expect(result).toMatchObject({ keep: true, confidence: 0.45, explicitness: "model_knowledge" });
    expect(result.evidence.map((ref) => ref.verificationStatus)).toEqual(["invalid", "model_knowledge"]);
  });
  it("retains explicit model-knowledge paraphrases observed in the live pilot, without upgrading certainty", async () => {
    const item = assertion([{ ...model, inferenceType: "paraphrase" }]);
    item.explicitness = "model_knowledge";
    item.scopeAssessment.anchors = [];
    const result = await verify(item, true);
    expect(result).toMatchObject({
      keep: true,
      confidence: 0.45,
      explicitness: "model_knowledge",
      evidence: [{ verificationStatus: "model_knowledge", inferenceType: "inferred" }],
    });
    expect(result.audit.evidence[0].reference.inferenceType).toBe("paraphrase");
    expect(result.audit.after.normalizedModelEvidenceIndexes).toEqual([0]);
  });
  it("does not relabel an unavailable source as model knowledge", async () => {
    const item = assertion([{ ...invalid, sourceRef: "missing-source", inferenceType: "inferred" }]);
    item.scopeAssessment.anchors = [];
    expect(await verify(item, true)).toMatchObject({ keep: false, confidence: 0 });
  });
  it("does not infer personal preferences from model knowledge", async () => {
    expect(await verify(assertion([model]))).toMatchObject({ keep: false });
  });
  it("retains real support alongside invalid evidence", async () => {
    const result = await verify(assertion([invalid, input]));
    expect(result).toMatchObject({ keep: true, confidence: 0.94, explicitness: "user_explicit" });
  });
  it("does not promote an inference into an explicit statement", async () => {
    const item = assertion([{ ...input, inferenceType: "inferred" }]);
    expect(await verify(item)).toMatchObject({ explicitness: "inferred", confidence: 0.94 });
  });
  it("distinguishes user statements from source-explicit facts", async () => {
    const item = assertion();
    item.explicitness = "source_explicit";
    expect(await verify(item, true)).toMatchObject({ explicitness: "user_explicit" });
  });
  it("requires available external source text and a matching anchor", async () => {
    const item = assertion([
      { ...input, sourceRef: null, inputPointer: null, sourceUrl: "https://example.com/source" },
    ]);
    expect(await verify(item, true, [])).toMatchObject({ keep: false });
  });
});

describe("references after evidence normalization", () => {
  it("remaps remaining assertion references and rebuilds an affected summary", async () => {
    const audit = fakeGroundedUnderstanding(frozenAudit(sparseFixtures[0]));
    audit.assertions = [audit.assertions[0]];
    audit.assertions.push({ ...audit.assertions[0], valueText: "保持される具体的な人物描写" });
    audit.aspectAssessments.narrativeRole = {
      kind: "concrete",
      reason: "fixture",
      summaryIndexes: [0],
      assertionIndexes: [0, 1],
    };
    const kept = await verify(assertion());
    const rejected = { ...kept, keep: false, confidence: 0 };
    const normalized = normalizeUnderstanding(audit, [rejected, kept], false);
    expect(normalized.assertions).toHaveLength(1);
    expect(normalized.summary.narrativeRole).toEqual(["保持される具体的な人物描写"]);
    expect(normalized.informationQuality.aspects.narrativeRole.assertionIndexes).toEqual([0]);
    expect(audit.assertions).toHaveLength(2);
  });
  it("explains missing content and does not invent references after all assertions are excluded", async () => {
    const audit = fakeGroundedUnderstanding(frozenAudit(sparseFixtures[0]));
    const kept = await verify(assertion());
    const normalized = normalizeUnderstanding(
      audit,
      audit.assertions.map(() => ({ ...kept, keep: false, confidence: 0 })),
      true,
    );
    expect(normalized.assertions).toEqual([]);
    expect(normalized.informationQuality).toMatchObject({
      contentAspectCount: 0,
      concreteAspectCount: 0,
      completionAttempted: true,
    });
    expect(normalized.informationQuality.aspects.narrativeRole).toMatchObject({
      kind: "unknown",
      summaryIndexes: [],
      assertionIndexes: [],
    });
    expect(normalized.summary.narrativeRole[0]).toContain("確認できません");
  });
});
