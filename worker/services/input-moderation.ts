import type { AnyEntryDraft, GenerationRequestInput } from "../../shared/schemas";
import { createModerationProvider } from "../moderation/providers";
import type { ModerationInput, ModerationProvider, ModerationResult } from "../moderation/types";
import type { Env } from "../types";

const FIELD_LABELS: Record<string, string> = {
  workTitle: "作品名",
  baseCharacterName: "元キャラクター名",
  characterName: "キャラクター名",
  mediaType: "媒体種別",
  characterBasicInfo: "キャラクター基本情報",
  referenceMaterial: "追加の参考情報",
  userCharacterView: "あなた自身の解釈",
  preferenceContext: "嗜好の前提",
  customizationDescription: "カスタム内容",
  "preference.likedReasons": "好きな理由",
  "preference.dislikedReasons": "苦手な理由",
  "preference.valueStanceNote": "価値観への立場",
  "darkContext.focusDescription": "注目するダーク状態・役割",
  "darkContext.beforeState": "変化前の状態",
  "darkContext.transitionTrigger": "変化のきっかけ",
  "darkContext.controllerOrInfluence": "支配者・影響源",
  "darkContext.controlMechanism": "支配・変化の仕組み",
  "darkContext.awarenessAndResistance": "自覚・抵抗",
  "darkContext.relationshipChange": "関係性の変化",
  "darkContext.responsibilityNote": "責任についての補足",
  "darkContext.desiredOutcome": "望む結末",
  "darkContext.contentBoundaries": "扱わない表現",
  purpose: "作成目的",
  world: "世界観",
  genre: "ジャンル",
  role: "物語上の役割",
  tone: "表現トーン",
  freeInstruction: "自由指示",
};

function collectStrings(value: unknown, path = ""): ModerationInput[] {
  if (typeof value === "string") {
    const text = value.trim();
    const field = FIELD_LABELS[path];
    if (!text || !field) return [];
    return [{ field, text }];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => collectStrings(child, path ? `${path}.${key}` : key));
}

export async function moderateEntryDraft(
  env: Env,
  draft: AnyEntryDraft,
  provider: ModerationProvider = createModerationProvider(env),
): Promise<ModerationResult> {
  return provider.moderate(collectStrings(draft));
}

export async function moderateGenerationInput(
  env: Env,
  input: GenerationRequestInput,
  provider: ModerationProvider = createModerationProvider(env),
): Promise<ModerationResult> {
  return provider.moderate(collectStrings(input));
}

export function moderationRejectionMessage(result: Extract<ModerationResult, { allowed: false }>): string {
  const causes = [...new Set(result.reasons.map((reason) => `${reason.field}：${reason.label}`))];
  return `入力内容の事前チェックで送信できない内容が見つかりました。${causes.join("、")}。内容を修正して再度お試しください。`;
}
