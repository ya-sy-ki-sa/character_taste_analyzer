import { responseChannelLabel } from "./response-channels";
import { valueOrientationLabel, valueStanceLabel } from "./value-stance-labels";

const attributeCategoryLabels: Readonly<Record<string, string>> = {
  aesthetic: "見た目・美的表現",
  agency_ability: "主体性・能力",
  change_outcome: "変化・結末",
  duality_conflict: "二面性・葛藤",
  expression_tone: "表現・雰囲気",
  goodness_relation: "善悪との関わり",
  motivation: "動機・目的",
  narrative_role: "物語での役割",
  personality: "性格",
  relationship: "他者との関係",
  speech: "話し方",
  value_morality: "価値観・道徳",
  vulnerability: "弱さ・脆さ",
  warmth_trust: "温かさ・信頼",
  other: "その他の属性",
};

const representationTypeLabels: Readonly<Record<string, string>> = {
  canonical_whole: "原典全体",
  media_adaptation: "媒体別の表現",
  facet: "特定の側面",
  scene_state: "特定の場面・状態",
  alternate_setting: "別設定",
  transformative: "二次創作・改変",
  user_interpretation: "独自解釈",
  original: "オリジナル",
};

const graphNodeTypeLabels: Readonly<Record<string, string>> = {
  user: "ユーザー",
  work: "作品",
  character_identity: "キャラクター",
  representation: "キャラクター像",
  attribute: "属性",
  raw_attribute: "自由記述の属性",
  response_channel: "惹かれ方",
  value_stance: "価値スタンス",
  context: "条件・対象範囲",
  profile_pattern: "嗜好パターン",
};

const graphEdgeTypeLabels: Readonly<Record<string, string>> = {
  likes: "惹かれる",
  dislikes: "苦手・避けたい",
  responds_via: "この惹かれ方に結びつく",
  conditioned_by: "この条件で当てはまる",
  represented_as: "このキャラクター像として表現",
  in_work: "この作品に登場",
  derived_from: "この基本像をもとにする",
  has_attribute: "この属性を持つ",
  has_stance: "この価値スタンスを持つ",
};

const snapshotItemTypeLabels: Readonly<Record<string, string>> = {
  dimension: "惹かれる属性",
  negative_preference: "避けたい属性",
  value_stance: "価値・善悪との関わり方",
};

const briefTreatmentLabels: Readonly<Record<string, string>> = {
  required: "必須条件",
  include: "反映する",
  weak_include: "控えめに反映する",
  explore: "発展させる",
  omit: "今回は使わない",
  prohibit: "入れない",
};

const briefCoverageStatusLabels: Readonly<Record<string, string>> = {
  satisfied: "反映済み",
  partially_satisfied: "一部反映",
  not_applicable: "対象外",
  violated: "条件違反",
};

const generationErrorLabels: Readonly<Record<string, string>> = {
  GENERATION_CONSTRAINT_VIOLATION: "指定した生成条件を満たせませんでした。",
  JOB_STEP_ATTEMPTS_EXHAUSTED: "再試行回数の上限に達しました。",
  PROFILE_REBUILDING: "嗜好プロフィールを再構築しています。",
  PROFILE_REQUIRED: "確認済みの嗜好プロフィールが必要です。",
  PROFILE_SNAPSHOT_NOT_FOUND: "生成に使う嗜好情報を確認できませんでした。",
  GENERATION_SELECTION_EMPTY: "生成に使う嗜好項目が選択されていません。",
  GENERATION_SELECTION_CONFLICT: "使う項目と入れない項目の指定が重複しています。",
};

export function attributeCategoryLabel(value: string): string {
  return attributeCategoryLabels[value] ?? "その他の属性";
}

export function representationTypeLabel(value: string): string {
  return representationTypeLabels[value] ?? "その他のキャラクター像";
}

export function graphNodeTypeLabel(value: string): string {
  return graphNodeTypeLabels[value] ?? "その他の項目";
}

export function graphEdgeTypeLabel(value: string): string {
  return graphEdgeTypeLabels[value] ?? "その他の関係";
}

export function graphNodeLabel(
  node: { id: string; type: string; label: string; attributes: Record<string, unknown> },
  attributeLabels: ReadonlyMap<string, string> = new Map(),
): string {
  if (node.type === "attribute") {
    const stableKey =
      typeof node.attributes.stableKey === "string"
        ? node.attributes.stableKey
        : node.id.startsWith("a:")
          ? node.id.slice(2)
          : null;
    return stableKey ? (attributeLabels.get(stableKey) ?? node.label) : node.label;
  }
  if (node.type === "response_channel") {
    return responseChannelLabel(node.id.startsWith("rc:") ? node.id.slice(3) : node.label);
  }
  if (node.type === "representation" && typeof node.attributes.representationType === "string") {
    const typeLabel = representationTypeLabel(node.attributes.representationType);
    return /（[^（）]+）$/u.test(node.label)
      ? node.label.replace(/（[^（）]+）$/u, `（${typeLabel}）`)
      : `${node.label}（${typeLabel}）`;
  }
  if (node.type === "value_stance" && typeof node.attributes.stance === "string") {
    const separator = node.label.lastIndexOf("：");
    const targetRef = separator >= 0 ? node.label.slice(0, separator) : node.label;
    const targetLabel =
      attributeLabels.get(targetRef) ?? (/^[a-z0-9_.-]+$/u.test(targetRef) ? "未分類の属性" : targetRef);
    return `${targetLabel}：${valueStanceLabel(node.attributes.stance)}`;
  }
  return node.label;
}

export function snapshotItemTypeLabel(value: string): string {
  return snapshotItemTypeLabels[value] ?? "その他の嗜好項目";
}

export function snapshotItemLabel(
  item: {
    type: string;
    stableKey: string;
    label: string;
    payload: Record<string, unknown>;
  },
  attributeLabels: ReadonlyMap<string, string> = new Map(),
): string {
  if (item.type === "dimension" || item.type === "negative_preference") {
    return attributeLabels.get(item.stableKey) ?? item.label;
  }
  if (item.type !== "value_stance") return item.label;

  const targetRef = typeof item.payload.targetRef === "string" ? item.payload.targetRef : "";
  const orientation = typeof item.payload.orientation === "string" ? item.payload.orientation : "";
  const stance = typeof item.payload.stance === "string" ? item.payload.stance : "";
  const storedTarget = item.label.includes("：") ? item.label.slice(0, item.label.lastIndexOf("：")) : item.label;
  const internalKeyPattern = /^[a-z0-9_.-]+$/u;
  const targetLabel =
    attributeLabels.get(targetRef) ??
    (!internalKeyPattern.test(storedTarget)
      ? storedTarget
      : orientation
        ? valueOrientationLabel(orientation)
        : "未分類の属性");

  return `${targetLabel}：${valueStanceLabel(stance)}`;
}

export function briefTreatmentLabel(value: string): string {
  return briefTreatmentLabels[value] ?? "扱い未設定";
}

export function briefCoverageStatusLabel(value: string): string {
  return briefCoverageStatusLabels[value] ?? "確認状態不明";
}

export function generationErrorLabel(value: string | null): string {
  if (!value) return "生成条件と構造化設定を処理しています。";
  return generationErrorLabels[value] ?? "生成処理中にエラーが発生しました。";
}
