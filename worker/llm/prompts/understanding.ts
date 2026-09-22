import { understandingAspectLabels } from "../../../shared/understanding-aspects";
import { SYSTEM_INSTRUCTION } from "./analysis";
export const UNDERSTANDING_INFORMATION_POLICY = "understanding-information/v2.1.0";

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

// Kept as a named compatibility export for quality tooling; runtime completeness
// is now judged by worker/features/analysis/judgment.ts.
export const UNDERSTANDING_INFORMATION_INSTRUCTION =
  "各人物像項目の情報量と根拠の不足はJevの意味判定へ渡し、コードが不明点と再検討を制御する。";

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
- 引用の物理照合、主張への意味的支持、資料の公式性を別々に扱う。公式・一次資料以外の直接引用は、引用確認済みでもsource_interpretedを上限とする。
- preferenceContext・userCharacterViewはユーザー解釈であり、作品の公式設定を裏付ける資料として使わない。
- 嗜好入力は意図的に含まれていない。人物の事実・解釈とユーザーが好きな属性を混同しない。`;

export const UNDERSTANDING_COMPLETION_INSTRUCTION = `[TASK:UNDERSTANDING_COMPLETION]
入力: 欠落している人物像項目、保持済みの人物描写、利用可能な入力Pointerと出典、元の登録情報。
指定された欠落項目を1巡だけ再検討する。改訂案は再び意味判定へ渡される。
処理:
1. 元の登録情報を基準に不足項目を再検討する。
2. 既成キャラクターは利用可能な公開情報検索とモデル知識で補完する。
3. オリジナル・カスタム固有の設定は入力資料の範囲を保持する。
4. 根拠を取得できない項目には項目別の不明理由を残す。
5. 保持済みのassertionを維持する。過去の削除理由から断定を再生成せず、利用可能な出典が支持する範囲だけを追加する。項目数を埋めるための創作は禁止。
出力: 指定Schemaに適合する完全な候補。`;

export function understandingSystem(): string {
  return [SYSTEM_INSTRUCTION, UNDERSTANDING_SOURCE_INSTRUCTION, UNDERSTANDING_COMPLETENESS_INSTRUCTION].join("\n");
}
