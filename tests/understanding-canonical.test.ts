import { describe, expect, it } from "vitest";
import type { UnderstandingCandidate } from "../shared/contracts/understanding";
import { understandingAuditSchema } from "../shared/contracts/understanding-quality";
import { type UnderstandingAspect, understandingAspects } from "../shared/understanding-aspects";
import { normalizeUnderstanding } from "../worker/features/analysis/normalize-understanding";
import { fakeGroundedUnderstanding } from "../worker/features/analysis/semantic-fake";
import { verifySemanticAssertion } from "../worker/features/analysis/semantic-integrity";
import { CitationRegistry } from "../worker/platform/provenance/registry";
import type { ProvenanceSource } from "../worker/platform/provenance/verifier";
import { understandingCanonicalCases } from "./fixtures/understanding-canonical";

type Item = {
  valueText: string;
  stableKey: string | null;
  source: "user" | "model";
  explicitness?: UnderstandingCandidate["assertions"][number]["explicitness"];
  scopeText?: string;
  actor?: string | null;
  negatedProposition?: string | null;
};

async function normalize(items: Item[], references: Partial<Record<UnderstandingAspect, number[]>>) {
  const pointer = "/characterBasicInfo";
  const assertions: UnderstandingCandidate["assertions"] = items.map((item) => ({
    attributeStableKey: item.stableKey,
    rawLabel: "人物描写",
    valueText: item.valueText,
    assertionKind: "setting",
    scopeText: item.scopeText ?? "",
    explicitness: item.explicitness ?? (item.source === "user" ? "user_explicit" : "model_knowledge"),
    confidence: item.source === "user" ? 0.9 : 0.4,
    evidence: [
      item.source === "user"
        ? {
            sourceRef: `input:${pointer}`,
            inputPointer: pointer,
            sourceUrl: null,
            quote: item.valueText,
            inferenceType: item.explicitness === "source_interpreted" ? "inferred" : "direct",
          }
        : {
            sourceRef: "model_knowledge",
            inputPointer: null,
            sourceUrl: null,
            quote: null,
            inferenceType: "inferred",
          },
    ],
  }));
  const summary = {
    identity: "固定した人物",
    narrativeRole: [] as string[],
    moralityOrientation: [] as string[],
    goals: [] as string[],
    values: [] as string[],
    behavior: [] as string[],
    relationships: [] as string[],
    expression: [] as string[],
  };
  const aspectAssessments = Object.fromEntries(
    understandingAspects.map((aspect) => {
      const indexes = references[aspect] ?? [];
      if (indexes.length) summary[aspect] = [items[indexes[0]].valueText];
      return [
        aspect,
        {
          kind: indexes.length ? "concrete" : "unknown",
          reason: "固定fixture",
          summaryIndexes: indexes.length ? [0] : [],
          assertionIndexes: indexes,
        },
      ];
    }),
  );
  const audit = fakeGroundedUnderstanding(
    understandingAuditSchema.parse({
      sourceAssessment: {
        coverage: "partial",
        limitations: [],
        modelKnowledgeUsed: items.some((item) => item.source === "model"),
      },
      summary,
      assertions,
      customizationDeltas: [],
      uncertainties: [],
      aspectAssessments,
    }),
  );
  audit.assertions.forEach((assertion, index) => {
    assertion.scopeAssessment.actor = items[index].actor ?? null;
    assertion.scopeAssessment.negatedProposition = items[index].negatedProposition ?? null;
  });
  const sources: ProvenanceSource[] = [
    {
      sourceId: "input",
      origin: "user_input",
      inputPointer: pointer,
      url: null,
      text: items
        .filter((item) => item.source === "user")
        .map((item) => item.valueText)
        .join("\n"),
    },
  ];
  const proofs = await Promise.all(
    audit.assertions.map((assertion, index) =>
      verifySemanticAssertion(
        assertion,
        sources,
        new Set(),
        new CitationRegistry(),
        { targetType: "character_assertion", targetId: `proof-${index}`, modelRunId: "fixture" },
        [],
      ),
    ),
  );
  expect(proofs.every((proof) => proof.keep)).toBe(true);
  return normalizeUnderstanding(audit, proofs, false);
}

describe("canonical understanding before persistence", () => {
  it("collapses 141 repeated slots from five frozen User A phrases", async () => {
    expect(understandingCanonicalCases.reduce((sum, item) => sum + item.duplicateSlots, 0)).toBe(141);
    for (const fixture of understandingCanonicalCases) {
      const rows = Array.from({ length: fixture.duplicateSlots }, (_, index) => ({
        valueText: index % 2 ? ` ${fixture.valueText} ` : fixture.valueText,
        stableKey: fixture.stableKey,
        source: "user" as const,
      }));
      const normalized = await normalize(rows, {
        [fixture.aspect]: rows.map((_, index) => index),
      });
      expect(normalized.assertions, fixture.caseId).toHaveLength(1);
      expect(normalized.canonicalSourceIndexes, fixture.caseId).toHaveLength(1);
      expect(normalized.aspectAssessments[fixture.aspect].assertionIndexes, fixture.caseId).toEqual([0]);
      expect(normalized.summary[fixture.aspect], fixture.caseId).toHaveLength(1);
    }
  });

  it("uses one canonical index from multiple aspects", async () => {
    const item: Item = {
      valueText: "弟を助けることを目的に、自分から行動する。",
      stableKey: "relationship.protective",
      source: "user",
    };
    const normalized = await normalize([item, item], { relationships: [0], goals: [1], behavior: [1] });
    expect(normalized.assertions).toHaveLength(1);
    for (const aspect of ["relationships", "goals", "behavior"] as const)
      expect(normalized.aspectAssessments[aspect].assertionIndexes).toEqual([0]);
    expect(normalized.informationQuality.groundedConcreteItemCount).toBe(1);
  });

  it("projects two distinct shared claims once each while retaining both categories", async () => {
    const normalized = await normalize(
      [
        { valueText: "物語を導きながら仲間を救うことを目指す。", stableKey: null, source: "user" },
        { valueText: "危機に立ち向かう主人公として成長を目指す。", stableKey: null, source: "user" },
      ],
      { narrativeRole: [0, 1], goals: [0, 1] },
    );
    expect(normalized.assertions).toHaveLength(2);
    expect(normalized.summary.narrativeRole).toHaveLength(1);
    expect(normalized.summary.goals).toHaveLength(1);
    expect(normalized.summary.narrativeRole[0]).not.toBe(normalized.summary.goals[0]);
    expect(normalized.informationQuality.concreteAspectCount).toBeGreaterThanOrEqual(2);
    expect(normalized.informationQuality.groundedConcreteItemCount).toBe(2);
  });

  it("retains a verified quote even when the generated label was model knowledge", async () => {
    const normalized = await normalize(
      [
        {
          valueText: "困っている仲間を助ける。",
          stableKey: "agency.proactive",
          source: "user",
          explicitness: "model_knowledge",
        },
      ],
      { behavior: [0] },
    );
    expect(normalized.assertions).toHaveLength(1);
    expect(normalized.assertions[0].explicitness).toBe("source_interpreted");
    expect(normalized.canonicalProofs[0].evidence[0].verificationStatus).toBe("verified_quote");
    expect(normalized.informationQuality.groundedConcreteItemCount).toBe(1);
  });

  it("keeps different subjects, conditions, and negations separate", async () => {
    const base: Item = { valueText: "仲間を助ける。", stableKey: "relationship.protective", source: "user" };
    for (const changed of [
      { ...base, actor: "別人" },
      { ...base, scopeText: "危機の時だけ" },
      { ...base, negatedProposition: "助けない" },
    ]) {
      const normalized = await normalize([base, changed], { relationships: [0, 1] });
      expect(normalized.assertions).toHaveLength(2);
      expect(normalized.aspectAssessments.relationships.assertionIndexes).toEqual([0, 1]);
    }
  });

  it("keeps distinct model knowledge without replacing grounded descriptions", async () => {
    const items: Item[] = [
      ...["目標Aを追う。", "目標Bを追う。", "目標Cを追う。"].map((valueText) => ({
        valueText,
        stableKey: "motivation.ambition",
        source: "user" as const,
      })),
      { valueText: "目標Aを追う。", stableKey: "motivation.ambition", source: "model" },
      { valueText: "物語を導く。", stableKey: "role.hero", source: "model" },
      { valueText: "公平に判断する。", stableKey: "morality.heroic", source: "model" },
      { valueText: "自分の信念を貫くことを大切にする。", stableKey: null, source: "model" },
      { valueText: "困難に向き合う。", stableKey: "agency.proactive", source: "model" },
      { valueText: "仲間に寄り添う。", stableKey: "relationship.devoted", source: "model" },
      { valueText: "穏やかな声で語る。", stableKey: "speech.playful", source: "model" },
    ];
    const normalized = await normalize(items, {
      goals: [0, 1, 2, 3],
      narrativeRole: [4],
      moralityOrientation: [5],
      values: [6],
      behavior: [7],
      relationships: [8],
      expression: [9],
    });
    expect(normalized.aspectAssessments.goals.assertionIndexes).toHaveLength(2);
    expect(normalized.assertions.filter((item) => item.explicitness === "model_knowledge")).toHaveLength(6);
    expect(
      normalized.assertions.some(
        (item) => item.valueText === "目標Aを追う。" && item.explicitness === "model_knowledge",
      ),
    ).toBe(false);
    expect(normalized.summary.narrativeRole[0]).toMatch(/^未照合（モデル知識）:/u);
    expect(normalized.sourceAssessment.modelKnowledgeUsed).toBe(true);
    expect(normalized.sourceAssessment.limitations).toContain(
      "未照合のモデル知識を含みます。人物の確認済み事実ではありません。",
    );
    expect(normalized.canonicalProofs.every((proof) => proof.evidence.length > 0)).toBe(true);
  });

  it("retains a broad existing-character portrait with clearly unverified knowledge", async () => {
    const normalized = await normalize(
      [
        { valueText: "物語の中心で成長する人物。", stableKey: "role.hero", source: "user" },
        { valueText: "人々を救うことを目標にしている。", stableKey: "motivation.ambition", source: "user" },
        { valueText: "危機でも他人を見捨てない。", stableKey: "morality.heroic", source: "model" },
        { valueText: "困っている人の安全を大切にする。", stableKey: null, source: "model" },
        { valueText: "相手を観察してから行動する。", stableKey: "ability.strategic", source: "model" },
        { valueText: "自分の弱さに向き合って努力する。", stableKey: "agency.proactive", source: "model" },
        { valueText: "師匠との信頼関係を築く。", stableKey: "relationship.devoted", source: "model" },
        {
          valueText: "未照合のモデル知識では、緊張が表情に出やすい。",
          stableKey: "expression.visible",
          source: "model",
        },
      ],
      {
        narrativeRole: [0],
        goals: [1],
        moralityOrientation: [2],
        values: [3],
        behavior: [4, 5],
        relationships: [6],
        expression: [7],
      },
    );
    expect(normalized.assertions).toHaveLength(8);
    expect(normalized.informationQuality.concreteAspectCount).toBe(7);
    expect(normalized.informationQuality.modelKnowledgeConcreteItemCount).toBe(6);
    expect(normalized.summary.values[0]).toMatch(/^未照合（モデル知識）:/u);
    expect(normalized.summary.expression).toEqual(["未照合（モデル知識）: 緊張が表情に出やすい。"]);
    expect(normalized.assertions.filter((item) => item.explicitness === "model_knowledge")).toHaveLength(6);
    expect(normalized.assertions.filter((item) => item.explicitness === "source_explicit")).toHaveLength(0);
  });

  it("splits a separately verified sentence from an unverified compound", async () => {
    const normalized = await normalize(
      [
        { valueText: "仲間を守る。", stableKey: "relationship.protective", source: "user" },
        {
          valueText: "仲間を守る。その後は静かな声で語る。",
          stableKey: "relationship.protective",
          source: "model",
        },
      ],
      { relationships: [0, 1], expression: [1] },
    );
    expect(normalized.assertions.map((item) => item.valueText)).toEqual(["仲間を守る。", "その後は静かな声で語る。"]);
    expect(normalized.assertions.map((item) => item.explicitness)).toEqual(["user_explicit", "model_knowledge"]);
    expect(normalized.aspectAssessments.relationships.assertionIndexes).toEqual([0]);
    expect(normalized.aspectAssessments.expression.assertionIndexes).toEqual([1]);
    expect(normalized.canonicalSourceIndexes).toEqual([0, 1]);
    expect(normalized.canonicalProofs[1].evidence.map((item) => item.verificationStatus)).toEqual(["model_knowledge"]);
  });
});
