import { understandingAspectLabels } from "../../../shared/understanding-aspects";
import { SYSTEM_INSTRUCTION } from "./analysis";
export const UNDERSTANDING_INFORMATION_POLICY = "understanding-information/v2.0.0";

export const UNDERSTANDING_COMPLETENESS_INSTRUCTION = `[TASK:UNDERSTANDING_COVERAGE]
キャラクター像の7項目をそれぞれ検討する。
[ASPECTS]
${Object.entries(understandingAspectLabels)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n")}
[OUTPUT_RULES:UNDERSTANDING]
- 各項目に根拠のある人物像を具体的な文章で記述し、対応するassertionsに根拠・出所を保持する。名前・作品名だけを人物像の完成とみなさない。
- 利用可能なモデル知識はexplicitness=model_knowledge、sourceRef=model_knowledgeとし、確信度を上げない。公開資料にないという理由だけで一律削除しない。
- 本当に不明な項目 → summaryの該当項目を空配列、uncertainties.topicを項目の英語キー、reasonを具体的な不明理由とする。
- 「不明」「確認できません」等の代替文をsummaryに入れない。
- 項目を埋めるための設定創作、ユーザー嗜好の人物事実への転用を禁止する。`;

export const UNDERSTANDING_SOURCE_INSTRUCTION = `[INPUT_MAPPING:UNDERSTANDING]
- 既成の一般的な基本像 := システム収集済み公開情報＋利用可能なモデル知識。
- 既成（カスタム）のbase stage := baseCharacterNameを元キャラクター名として基本像を構成。
- 既成（カスタム）のtarget stage := characterNameをカスタム後の名前として扱う。
- オリジナルの一般的な基本像 := characterBasicInfo。
- referenceMaterial := ユーザーが任意提供した補足情報。
- userCharacterView := ユーザー自身の解釈。
[UNRESOLVED:UNDERSTANDING_SOURCE]
- 検索結果が対象と不一致／情報競合／根拠が弱い → 断定せずlimitationsまたはuncertaintiesに記録。
[INVARIANTS:UNDERSTANDING_SOURCE]
- 出所を混同しない。
- 嗜好入力は意図的に含まれていない。人物の事実・解釈とユーザーが好きな属性を混同しない。`;

export const UNDERSTANDING_COMPLETION_INSTRUCTION = `[TASK:UNDERSTANDING_COMPLETION]
入力: 意味判定・根拠検証後の人物像、不足・矛盾・低確信の論点、元の登録情報。
指定された論点を最大2巡の範囲で再検討する。改訂案は再び意味判定へ渡される。
処理:
1. 元の登録情報を基準に不足項目を再検討する。
2. 既成キャラクターは利用可能な公開情報検索とモデル知識で補完する。
3. オリジナル・カスタム固有の設定は入力資料の範囲を保持する。
4. 根拠を取得できない項目には項目別の不明理由を残す。
5. 除外された断定をそのまま復活させない。除外理由を解消する根拠を得るか、支持される対象範囲へ修正する。反復して項目数を埋めるための創作は禁止。
出力: 指定Schemaに適合する完全な候補。`;

export function understandingSystem(): string {
  return [SYSTEM_INSTRUCTION, UNDERSTANDING_SOURCE_INSTRUCTION, UNDERSTANDING_COMPLETENESS_INSTRUCTION].join("\n");
}
