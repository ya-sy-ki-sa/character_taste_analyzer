import { describe, expect, it } from "vitest";
import { anyEntryDraftSchema } from "../shared/contracts/entries";
import { summarizeUnderstandingEvidence } from "../shared/understanding-evidence";
import { buildCharacterMarkdown, characterMarkdownFilename } from "../src/lib/entry-markdown";

const evidence = (inputPointer: string, quote: string) => ({
  verificationStatus: "verified_quote",
  inferenceType: "direct",
  quote,
  inputPointer,
  sourceTitle: "登録資料",
  sourceUrl: null,
  sourceProvider: null,
  trustReason: null,
});

describe("character registration Markdown", () => {
  it("includes character information and excludes every preference section and input", () => {
    const detail = {
      entry: {
        id: crypto.randomUUID(),
        status: "active",
        draft: {
          registrationType: "customized_existing" as const,
          workTitle: "作品A",
          baseCharacterName: "原典人物",
          characterName: "改変人物",
          mediaType: "アニメ版",
          representationType: "alternate_setting" as const,
          customizationDescription: "別世界で研究者として暮らしている。",
          identityResolution: { mode: "new" as const },
          preferenceContext: "秘密の好きな場面",
          referenceMaterial: "公開プロフィールの補足。",
          userCharacterView: "冷静だが他者を見捨てない人物。",
          preference: {
            likedReasons: "秘密の好きな理由",
            dislikedReasons: "秘密の苦手な理由",
            responseChannels: ["person_liking" as const],
            valueStanceNote: "秘密の価値スタンス",
          },
        },
      },
      baseUnderstanding: {
        sourceAssessment: { coverage: "sufficient", limitations: [] },
        summary: { identity: "原典では規律を重視する人物。", goals: ["秩序を守る"] },
        uncertainties: [],
        evidenceSummary: summarizeUnderstandingEvidence([
          {
            status: "confirmed",
            evidence: [
              { id: "ref", verificationStatus: "verified_quote", evidenceOrigin: "user_input" },
              { id: "pref", verificationStatus: "verified_quote", evidenceOrigin: "user_input" },
            ],
          },
        ]),
        assertions: [
          {
            raw_label: "規律",
            value_text: "規律を優先する。",
            explicitness: "source_explicit",
            confidence: 0.92,
            status: "confirmed",
            evidence: [
              evidence("/referenceMaterial", "公開プロフィールの補足"),
              evidence("/preference/likedReasons", "秘密の好きな理由"),
            ],
          },
        ],
      },
      understanding: {
        sourceAssessment: { coverage: "partial", limitations: ["終盤の資料が少ない"] },
        summary: { identity: "別世界では研究者として他者を支える。", relationships: ["共同研究者を守る"] },
        uncertainties: [{ topic: "過去", reason: "資料がない" }],
        evidenceSummary: summarizeUnderstandingEvidence([]),
        assertions: [],
        deltas: [
          {
            operation: "modify",
            before_value: "規律を優先する",
            after_value: "人命を優先する",
            reason_text: "登録された別設定による",
            confidence: 0.88,
            status: "confirmed",
          },
        ],
      },
      preferenceAnalysis: {
        summary: { userExplicitSummary: ["絶対に出力しない好みの要約"] },
        assertions: [{ raw_label: "絶対に出力しない好みの候補" }],
        valueStances: [{ target_ref: "絶対に出力しない価値スタンス" }],
      },
    };

    const markdown = buildCharacterMarkdown(detail);

    expect(markdown).toContain("# 改変人物");
    expect(markdown).not.toContain("全体登録内支持度");
    expect(markdown).toContain("資料の網羅性（解析時点）");
    expect(markdown).toContain("情報量は未評価");
    expect(markdown).toContain("ユーザー入力の原文照合済み: 2件");
    expect(markdown).toContain("登録内支持度: 92%");
    expect(markdown).toContain("作品A");
    expect(markdown).toContain("既成キャラクターの基本像");
    expect(markdown).toContain("別世界では研究者として他者を支える");
    expect(markdown).toContain("人命を優先する");
    expect(markdown).toContain("公開プロフィールの補足");
    expect(markdown).not.toContain("秘密の好きな場面");
    expect(markdown).not.toContain("秘密の好きな理由");
    expect(markdown).not.toContain("秘密の苦手な理由");
    expect(markdown).not.toContain("絶対に出力しない");
    expect(markdown).not.toContain("この登録から読み取った");
  });

  it("creates a filesystem-safe Japanese filename", () => {
    expect(
      characterMarkdownFilename({
        registrationType: "original",
        characterName: '人物/名前:*?"<>|',
        characterBasicInfo: "設定",
        preferenceContext: undefined,
        referenceMaterial: undefined,
        userCharacterView: undefined,
        preference: {
          likedReasons: undefined,
          dislikedReasons: undefined,
          responseChannels: [],
          valueStanceNote: undefined,
        },
      }),
    ).toBe("人物_名前_______-登録情報.md");
  });
});

it("renders nested dark-state summaries without treating them as strings", () => {
  const markdown = buildCharacterMarkdown({
    entry: {
      id: "dark-entry",
      status: "active",
      draft: anyEntryDraftSchema.parse({
        registrationType: "original",
        characterName: "試験対象",
        characterBasicInfo: "架空の人物",
        preference: { responseChannels: [] },
        darkContext: { focusDescription: "支配に抵抗する状態", archetypeHints: [] },
      }),
    },
    baseUnderstanding: null,
    understanding: {
      sourceAssessment: { coverage: "partial", limitations: [] },
      summary: {
        darkState: {
          agencyOrigin: "externally_imposed",
          consent: "coerced",
          awareness: "aware",
          resistance: "internal_only",
          identityContinuity: "intact",
          responsibility: "reduced",
          reversibility: "conditional",
          controllerOrInfluence: null,
          mechanism: null,
          before: "意思が残っている",
          onset: null,
          activeState: "支配に抵抗している",
          recoveryOrAfter: null,
        },
      },
      evidenceSummary: summarizeUnderstandingEvidence([]),
      uncertainties: [],
      assertions: [],
    },
  });
  expect(markdown).toContain("支配に抵抗している");
  expect(markdown).toContain("意思が残っている");
});
