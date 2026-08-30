import { attributeCategoryLabel, representationTypeLabel } from "../../shared/presentation-labels";
import { valueOrientationLabel, valueStanceLabel } from "../../shared/value-stance-labels";

const graphAttributeLabels: Readonly<Record<string, string>> = {
  category: "属性カテゴリ",
  classification: "傾向の状態",
  representationType: "キャラクター像の種類",
  orientation: "対象の価値傾向",
  stance: "あなたの捉え方",
  scope: "対象範囲",
  entryScope: "登録内の対象範囲",
  subjects: "対象",
  relationships: "関係性",
  narrativePhases: "物語上の局面",
  conditions: "条件",
  exceptions: "例外",
};

const graphClassificationLabels: Readonly<Record<string, string>> = {
  stable: "安定傾向",
  emerging: "発展中",
  insufficient: "データ不足",
};

function graphAttributeValue(key: string, value: unknown): string {
  if (key === "category") return attributeCategoryLabel(String(value));
  if (key === "classification") return graphClassificationLabels[String(value)] ?? "状態未分類";
  if (key === "representationType") return representationTypeLabel(String(value));
  if (key === "orientation") return valueOrientationLabel(String(value));
  if (key === "stance") return valueStanceLabel(String(value));
  if (Array.isArray(value)) return value.map(String).join("、");
  return String(value);
}

export function graphAttributeEntries(attributes: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(attributes).flatMap(([key, value]) => {
    const label = graphAttributeLabels[key];
    if (!label || value === null || value === undefined || value === "") return [];
    return [[label, graphAttributeValue(key, value)] as [string, string]];
  });
}
