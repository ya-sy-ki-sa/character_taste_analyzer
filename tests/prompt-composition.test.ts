import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  darkGeneratedCharacterCandidateSchema,
  generatedCharacterCandidateSchema,
} from "../shared/contracts/generation";
import { groundedUnderstandingAuditSchema } from "../shared/contracts/semantic-audit";
import { responseChannelCatalog, responseChannelPrompt } from "../shared/response-channels";
import { DARK_GENERATION_SYSTEM, GENERATION_SYSTEM } from "../worker/llm/prompts/generation";
import { hypothesisSystem } from "../worker/llm/prompts/hypotheses";
import {
  generationCheckQuestion,
  generationRankingQuestion,
  policyInstructions,
} from "../worker/llm/prompts/judgment-generation";
import { promptRegistry } from "../worker/llm/prompts/registry";

describe("prompt composition boundaries", () => {
  it("registers generation judgments without the retired LLM validation/comparison prompts", () => {
    expect(promptRegistry).toHaveProperty("generationJudgment");
    expect(promptRegistry).not.toHaveProperty("generationValidation");
    expect(promptRegistry).not.toHaveProperty("generationComparison");
  });
  it("retains the standard response definitions in discovery without leaking them into dark", () => {
    const text = promptRegistry.preference.text;
    expect(text.split(responseChannelPrompt())).toHaveLength(2);
    for (const channel of responseChannelCatalog)
      expect(text).toContain(`${channel.value}: ${channel.label} — ${channel.description}`);
    expect(promptRegistry.darkPreference.text).not.toContain(responseChannelPrompt());
  });
  it("keeps the persisted evidence-set contract and historical omissions compatible", () => {
    const assertion = groundedUnderstandingAuditSchema.shape.assertions.element;
    expect(z.toJSONSchema(assertion, { target: "draft-7" }).required).toContain("evidenceSetAssessment");
    expect(assertion.shape.evidenceSetAssessment.parse(undefined)).toBeNull();
  });
  it.each(["standard", "dark"] as const)("%s receives only its attribute and channel policy", (domain) => {
    for (const text of [
      domain === "dark" ? promptRegistry.darkPreference.text : promptRegistry.preference.text,
      hypothesisSystem(domain),
    ]) {
      expect(text).toContain("作品固有の固有名詞");
      if (domain === "dark") {
        expect(text).toContain("一般的特徴を捨象");
        expect(text).not.toMatch(/通常版の|wishful_identification|単独の属性として扱う/u);
      } else {
        expect(text).toContain("単独の属性として扱う");
        expect(text).not.toMatch(/一般的特徴を捨象|ダーク領域に限定|専用反応経路/u);
      }
    }
  });
  it("hypotheses remain unconfirmed suggestions", () => {
    for (const domain of ["standard", "dark"] as const) {
      const text = hypothesisSystem(domain);
      expect(text).toContain("ユーザーがまだ好みを明言していない特徴も");
      expect(text).toContain("最大6件");
      expect(text).not.toMatch(/\b(evidence|context|summary|uncertainties|confidence|supportAssessment)\b/u);
    }
  });
  it("generation pointer examples exist in each domain schema", () => {
    for (const domain of ["standard", "dark"] as const) {
      const schema = z.toJSONSchema(
        domain === "dark" ? darkGeneratedCharacterCandidateSchema : generatedCharacterCandidateSchema,
      );
      const text = domain === "dark" ? DARK_GENERATION_SYSTEM : GENERATION_SYSTEM;
      const pointers = text.match(/\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)+/gu) ?? [];
      expect(pointers.length).toBeGreaterThan(0);
      for (const pointer of pointers) {
        let node: Record<string, unknown> | undefined = schema;
        for (const token of pointer.slice(1).split("/"))
          node = (node?.properties as Record<string, Record<string, unknown>> | undefined)?.[token];
        expect(node, `${domain}: ${pointer}`).toBeDefined();
      }
      if (domain === "standard") expect(text).not.toContain("/darkCore/");
      else expect(text).toContain("辞書外属性（raw:など）");
    }
  });
  it("gives policy checks an uncertain result and ranks independent dimensions", () => {
    for (const [policy, aspects] of Object.entries(policyInstructions)) {
      for (const [index] of aspects.entries())
        expect(generationCheckQuestion(0, policy as keyof typeof policyInstructions, index).criteria).toHaveProperty(
          "uncertain",
        );
    }
    for (const axis of ["preferenceFit", "coherence", "difference"] as const) {
      const question = generationRankingQuestion(0, axis);
      expect(question.instructions).toContain("candidates[0].character");
      expect(question.criteria.length).toBeGreaterThanOrEqual(2);
      expect(question.criteria.length).toBeLessThanOrEqual(10);
    }
  });
});
