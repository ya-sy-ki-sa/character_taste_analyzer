import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  darkGeneratedCharacterCandidateSchema,
  generatedCharacterCandidateSchema,
} from "../shared/contracts/generation";
import { groundedUnderstandingAuditSchema } from "../shared/contracts/semantic-audit";
import {
  DARK_BASELINE_SYSTEM,
  DARK_UNDERSTANDING_AUDIT_SYSTEM,
  DARK_UNDERSTANDING_SYSTEM,
} from "../worker/llm/prompts/dark";
import {
  DARK_GENERATION_SYSTEM,
  GENERATION_SYSTEM,
  generationValidationSystem,
} from "../worker/llm/prompts/generation";
import { hypothesisSystem } from "../worker/llm/prompts/hypotheses";
import { preferenceSystem } from "../worker/llm/prompts/preference";
import { understandingSystem } from "../worker/llm/prompts/understanding";

describe("prompt composition boundaries", () => {
  it("requires an evidence-set decision in generated audits while accepting historical omissions", () => {
    const assertion = groundedUnderstandingAuditSchema.shape.assertions.element;
    expect(z.toJSONSchema(assertion, { target: "draft-7" }).required).toContain("evidenceSetAssessment");
    expect(assertion.shape.evidenceSetAssessment.parse(undefined)).toBeNull();
  });
  it.each(["standard", "dark"] as const)("%s receives only its attribute and channel policy", (domain) => {
    for (const text of [
      preferenceSystem(domain, "extract"),
      preferenceSystem(domain, "audit"),
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

  it("hypotheses allow unconfirmed preferences without extraction or audit output fields", () => {
    for (const domain of ["standard", "dark"] as const) {
      const text = hypothesisSystem(domain);
      expect(text).toContain("ユーザーがまだ好みを明言していない特徴も");
      expect(text).toContain("最大6件");
      expect(text).toContain("description・reason・scope");
      expect(text).not.toMatch(/\b(evidence|context|summary|uncertainties|confidence|supportAssessment)\b/u);
      expect(text).not.toContain("attributeStableKey=null");
    }
  });

  it("understanding audit and pre-change baseline exclude preference-only policies", () => {
    expect(understandingSystem("audit")).toContain("aspectAssessments");
    expect(understandingSystem("audit")).toContain("supportAssessment");
    expect(understandingSystem("audit")).not.toMatch(/userExplicitSummary|responseChannel|preferenceAssertions/u);
    expect(understandingSystem("extract")).not.toContain("aspectAssessments");
    expect(DARK_BASELINE_SYSTEM).not.toMatch(/一般属性は単独で出力しない|一般的特徴を捨象/u);
    expect(DARK_UNDERSTANDING_SYSTEM).toContain("一般属性は単独で出力しない");
    expect(DARK_UNDERSTANDING_AUDIT_SYSTEM).toContain("一般属性は単独で出力しない");
    expect(preferenceSystem("dark", "audit")).not.toMatch(/aspectAssessments|supportAssessment/u);
  });

  it("generation and validation pointer examples exist in the selected character schema", () => {
    for (const domain of ["standard", "dark"] as const) {
      const schema = z.toJSONSchema(
        domain === "dark" ? darkGeneratedCharacterCandidateSchema : generatedCharacterCandidateSchema,
      );
      for (const text of [
        domain === "dark" ? DARK_GENERATION_SYSTEM : GENERATION_SYSTEM,
        generationValidationSystem(domain),
      ]) {
        const pointers = text.match(/\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)+/gu) ?? [];
        expect(pointers.length).toBeGreaterThan(0);
        for (const pointer of pointers) {
          let node: Record<string, unknown> | undefined = schema;
          for (const token of pointer.slice(1).split("/")) {
            node = (node?.properties as Record<string, Record<string, unknown>> | undefined)?.[token];
          }
          expect(node, `${domain}: ${pointer}`).toBeDefined();
        }
        if (domain === "standard") expect(text).not.toContain("/darkCore/");
        else expect(text).toContain("辞書外属性（raw:など）");
      }
    }
  });
});
