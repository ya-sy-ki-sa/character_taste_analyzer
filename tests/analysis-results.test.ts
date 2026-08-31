import { describe, expect, it } from "vitest";
import {
  attributeCategoryLabel,
  briefCoverageStatusLabel,
  briefTreatmentLabel,
  generationErrorLabel,
  graphEdgeTypeLabel,
  graphNodeLabel,
  graphNodeTypeLabel,
  representationTypeLabel,
  snapshotItemTypeLabel,
  snapshotItemLabel,
} from "../shared/presentation-labels";
import { responseChannelLabel } from "../shared/response-channels";
import { valueOrientationLabel, valueStanceLabel } from "../shared/value-stance-labels";
import { evidenceQuoteLabel, explicitnessLabel } from "../src/lib/analysis-labels";
import { graphAttributeEntries } from "../src/lib/graph-labels";
import { hasPreferenceAnalysisCandidates } from "../worker/services/analysis-result-policy";
import { analysisFailureMetadata, safeAnalysisErrorDetail } from "../worker/services/analysis";
import { localizeAttributeReference, localizeUnderstandingSummary } from "../worker/services/attribute-labels";
import { LlmProviderError, type LlmRunMetadata } from "../worker/llm/types";

describe("preference analysis result validation", () => {
  it("treats a result without preferences or value stances as empty", () => {
    expect(hasPreferenceAnalysisCandidates({ preferenceAssertions: [], valueStanceAssertions: [] })).toBe(false);
  });

  it("accepts a result containing either kind of preference evidence", () => {
    expect(
      hasPreferenceAnalysisCandidates({
        preferenceAssertions: [{}] as never[],
        valueStanceAssertions: [],
      }),
    ).toBe(true);
    expect(
      hasPreferenceAnalysisCandidates({
        preferenceAssertions: [],
        valueStanceAssertions: [{}] as never[],
      }),
    ).toBe(true);
  });
});

describe("analysis error diagnostics", () => {
  const metadata = (
    responseId: string,
    responseStatus: string,
    safetySignal: "none" | "incomplete",
  ): LlmRunMetadata => ({
    provider: "openai",
    transport: "ai_gateway",
    adapterVersion: "1.0.0",
    requestedModel: "gpt-5.6-luna",
    resolvedModel: "gpt-5.6-luna",
    providerRequestId: `req_${responseId}`,
    outputTokens: responseStatus === "incomplete" ? 100_000 : 2_395,
    latencyMs: 1,
    dataRetentionMode: "no_retention",
    effectiveSettings: { maxOutputTokens: 100_000 },
    providerResponseDiagnostics: {
      requestId: `req_${responseId}`,
      responseId,
      responseStatus,
      incompleteReason: responseStatus === "incomplete" ? "max_output_tokens" : undefined,
      safetySignal,
    },
  });

  it("uses the failed call metadata instead of a preceding successful call", () => {
    const completedMetadata = metadata("resp_completed", "completed", "none");
    const failedMetadata = metadata("resp_failed", "incomplete", "incomplete");
    const error = new LlmProviderError(
      "OpenAIの回答が未完了でした",
      "EXTERNAL_PROVIDER_INCOMPLETE",
      false,
      "未完了理由: max_output_tokens",
    );
    error.attempts = [{ output: { errorCode: error.code }, metadata: failedMetadata }];

    const selected = analysisFailureMetadata(error, completedMetadata);
    const detail = safeAnalysisErrorDetail(error, selected);

    expect(selected).toBe(failedMetadata);
    expect(detail).toContain("ProviderリクエストID: req_resp_failed");
    expect(detail).toContain("OpenAI応答ID: resp_failed");
    expect(detail).toContain("応答状態: incomplete");
    expect(detail).toContain("応答分類: 未完了");
    expect(detail).toContain("安全関連シグナル: 検出なし");
    expect(detail).toContain("出力トークン: 100000／上限: 100000");
    expect(detail).not.toContain("resp_completed");
    expect(detail?.match(/max_output_tokens/gu)).toHaveLength(1);
  });
});

describe("understanding summary presentation labels", () => {
  const labels = new Map([
    ["role.hero", "ヒーロー"],
    ["role.supporting", "脇役"],
    ["morality.heroic", "英雄的方向性"],
    ["goodness.hostile", "善への敵対"],
    ["role.villain", "ヴィラン"],
  ]);

  it("localizes stable keys supplied as an array", () => {
    expect(
      localizeUnderstandingSummary(
        {
          identity: "原典キャラクターの説明",
          narrativeRole: ["role.hero", "role.supporting"],
        },
        labels,
      ),
    ).toEqual({
      identity: "原典キャラクターの説明",
      narrativeRole: ["ヒーロー", "脇役"],
    });
    expect(localizeAttributeReference("role.villain", labels)).toBe("ヴィラン");
  });

  it("localizes comma-separated stable keys without exposing unknown internal keys", () => {
    expect(
      localizeUnderstandingSummary(
        {
          narrativeRole: "role.hero, role.supporting",
          moralityOrientation: "morality.heroic、goodness.unknown",
        },
        labels,
      ),
    ).toEqual({
      narrativeRole: "ヒーロー、脇役",
      moralityOrientation: "英雄的方向性、未分類の属性",
    });
  });

  it("does not replace key-like text embedded in prose", () => {
    expect(localizeUnderstandingSummary({ identity: "role.hero を元にした説明" }, labels)).toEqual({
      identity: "role.hero を元にした説明",
    });
  });
});

describe("value stance presentation labels", () => {
  it("explains the target orientation and the user's stance in Japanese", () => {
    expect(valueOrientationLabel("evil")).toBe("悪そのもの");
    expect(valueOrientationLabel("transgressive")).toBe("規範からの逸脱");
    expect(valueStanceLabel("affirm")).toBe("肯定的に捉える");
  });

  it("uses a Japanese fallback for an unknown future value", () => {
    expect(valueOrientationLabel("future_orientation")).toBe("その他の価値傾向");
    expect(valueStanceLabel("future_stance")).toBe("判断区分なし");
  });
});

describe("preference candidate presentation labels", () => {
  it("localizes response channels, evidence quotes, and explicitness", () => {
    expect(responseChannelLabel("fascination_with_transgression")).toBe("逸脱や禁忌に惹かれる");
    expect(responseChannelLabel("emotional_impact")).toBe("強く心を動かされる");
    expect(responseChannelLabel("narrative_interest")).toBe("物語を面白くする");
    expect(explicitnessLabel("user_explicit")).toBe("ユーザーが明示");
    expect(explicitnessLabel("inferred")).toBe("入力から推定");
    expect(responseChannelLabel("future_response")).toBe("その他の反応");
    expect(explicitnessLabel("future_explicitness")).toBe("根拠区分未分類");
    expect(evidenceQuoteLabel("emotional_impact", "/preference/responseChannels")).toBe("強く心を動かされる");
    expect(evidenceQuoteLabel('["narrative_interest","emotional_impact"]', "/preference/responseChannels")).toBe(
      "物語を面白くする、強く心を動かされる",
    );
    expect(evidenceQuoteLabel("入力された文章", "/preference/likedReasons")).toBe("入力された文章");
  });
});

describe("cross-screen presentation labels", () => {
  it("localizes profile, graph, and generation terms", () => {
    expect(attributeCategoryLabel("narrative_role")).toBe("物語での役割");
    expect(representationTypeLabel("alternate_setting")).toBe("別設定");
    expect(graphNodeTypeLabel("response_channel")).toBe("惹かれ方");
    expect(graphEdgeTypeLabel("conditioned_by")).toBe("この条件で当てはまる");
    expect(snapshotItemTypeLabel("negative_preference")).toBe("避けたい属性");
    expect(
      snapshotItemLabel(
        {
          type: "value_stance",
          stableKey: "value:evil:affirm:hash",
          label: "morality.evil：affirm",
          payload: { targetRef: "morality.evil", orientation: "evil", stance: "affirm" },
        },
        new Map([["morality.evil", "悪そのものへの志向"]]),
      ),
    ).toBe("悪そのものへの志向：肯定的に捉える");
    expect(
      snapshotItemLabel({
        type: "value_stance",
        stableKey: "value:evil:affirm:hash",
        label: "action.forced_brainwashing_and_subjugation：affirm",
        payload: {
          targetRef: "action.forced_brainwashing_and_subjugation",
          orientation: "evil",
          stance: "affirm",
        },
      }),
    ).toBe("悪そのもの：肯定的に捉える");
    expect(briefTreatmentLabel("weak_include")).toBe("控えめに反映する");
    expect(briefCoverageStatusLabel("partially_satisfied")).toBe("一部反映");
    expect(generationErrorLabel("GENERATION_CONSTRAINT_VIOLATION")).toBe("指定した生成条件を満たせませんでした。");
    expect(generationErrorLabel("FUTURE_ERROR")).toBe("生成処理中にエラーが発生しました。");
    expect(
      graphNodeLabel({
        id: "rc:fascination_with_transgression",
        type: "response_channel",
        label: "fascination_with_transgression",
        attributes: {},
      }),
    ).toBe("逸脱や禁忌に惹かれる");
    expect(
      graphNodeLabel({
        id: "cr:1",
        type: "representation",
        label: "暁ナルト（transformative）",
        attributes: { representationType: "transformative" },
      }),
    ).toBe("暁ナルト（二次創作・改変）");
    expect(
      graphNodeLabel(
        {
          id: "vs:evil:affirm:1",
          type: "value_stance",
          label: "morality.evil：affirm",
          attributes: { orientation: "evil", stance: "affirm" },
        },
        new Map([["morality.evil", "悪そのものへの志向"]]),
      ),
    ).toBe("悪そのものへの志向：肯定的に捉える");
  });

  it("shows only understandable graph attributes and hides technical identifiers", () => {
    expect(
      graphAttributeEntries({
        stableKey: "role.hero",
        profileDimensionId: "internal-id",
        category: "narrative_role",
        classification: "stable",
        representationType: "alternate_setting",
        orientation: "transgressive",
        stance: "affirm",
        subjects: ["主人公", "宿敵"],
      }),
    ).toEqual([
      ["属性カテゴリ", "物語での役割"],
      ["傾向の状態", "安定傾向"],
      ["キャラクター像の種類", "別設定"],
      ["対象の価値傾向", "規範からの逸脱"],
      ["あなたの捉え方", "肯定的に捉える"],
      ["対象", "主人公、宿敵"],
    ]);
  });
});
