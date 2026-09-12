import { understandingAspectLabels } from "../../../shared/understanding-aspects";
import { SYSTEM_INSTRUCTION } from "./analysis";
import { UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION } from "./semantic-audit";
export const UNDERSTANDING_INFORMATION_POLICY = "understanding-information/v1.7.0";

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

export const UNDERSTANDING_INFORMATION_INSTRUCTION = `[TASK:INFORMATION_AUDIT]
改訂後の人物像の7項目すべてについて、情報量を独立監査する。
[DEFINITIONS:INFORMATION_KIND]
- concrete := 具体的な人物描写と対応するassertionがある。行動・目的・重視するもの・関わり方・表現等が分かること。
- label_only := 分類名だけ。
- attribution_only := 出所・解釈の注記だけ。
- unknown := 内容が空。
[OUTPUT_CONTRACT:INFORMATION_AUDIT]
- aspectAssessmentsに全7項目を返す。
- reason := 項目ごとの具体的な判定理由。
- summaryIndexes := 改訂後の同じ項目のsummary配列への0始まりの参照番号。
- assertionIndexes := 改訂後のassertions配列への0始まりの参照番号。
[DECISION_RULES:INFORMATION_AUDIT]
- 要約が分類名でも、参照先assertionに具体的描写があればconcreteを許容する。
- 名前・作品・媒体・時期の同定だけを人物描写に数えない。
- ユーザー解釈にも具体的な人物描写があれば、出所を区別してconcreteを許容する。
- 同じ注記の複数項目への分散や分類名の言い換えで具体性を増やさない。
- モデル知識の出所を保持する。公開資料にないという理由だけで削除しない。
- 情報量と引用の正しさ・事実の確実性を独立に扱う。
- 内容のある項目が1つ以下、またはconcreteが2項目未満 → 補完対象。項目数を満たすための創作は禁止。
- 設定の少ない端役・創作人物・場面限定の対象は情報不足を許容する。
- 媒体・時期、オリジナル・カスタムの入力範囲を保持する。好みを人物設定へ転用しない。
[BOUNDARY_EXAMPLES:INFORMATION_AUDIT]
- 「ヒーロー」「主人公」のみ → label_only。
- 「友達以上と読むのはユーザーの解釈であり公式設定ではない」のみ → attribution_only。
- ユーザー解釈として「人物Aが人物Bの肩書きより本人を見て遠慮なく接する」→ 対応するassertionとともにconcreteを許容。`;

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

export const UNDERSTANDING_AUDIT_INSTRUCTION = `[TASK:UNDERSTANDING_AUDIT]
- 理解候補を元資料と照合し、根拠のない断定・カスタム差分の誤りを訂正する。
- 完全な改訂候補を返す。嗜好は分析しない。
[INVARIANTS:UNDERSTANDING_AUDIT]
- 新しい事実・出典を創作しない。モデル知識の確信度を上げない。
- 候補内のモデル知識は、公開資料にないという理由だけで削除しない。対象との不一致・矛盾・知識自体の不確かさがある場合に修正する。
- 削除で空になった項目には項目別の不明理由を残す。`;

export const UNDERSTANDING_COMPLETION_INSTRUCTION = `[TASK:UNDERSTANDING_COMPLETION]
入力: 根拠検証・正規化後の不足した人物像、不足・除外理由、元の登録情報。
処理:
1. 元の登録情報を基準に不足項目を再検討する。
2. 既成キャラクターは利用可能な公開情報検索とモデル知識で補完する。
3. オリジナル・カスタム固有の設定は入力資料の範囲を保持する。
4. 根拠を取得できない項目には項目別の不明理由を残す。
5. 除外された断定をそのまま復活させない。除外理由を解消する根拠を得るか、支持される対象範囲へ修正する。反復して項目数を埋めるための創作は禁止。
出力: 指定Schemaに適合する完全な候補。`;

export const UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION = `[TASK:UNDERSTANDING_ASSESSMENT_REPAIR]
入力: 固定した人物像と修復対象のaspectAssessments。
変更可能範囲: aspectAssessmentsのみ。人物像本体の追加・変更は禁止。
[REFERENCE_RULES]
- summaryIndexesは各項目内、assertionIndexesは属性一覧内の0始まりの番号。
- 重複・範囲外の参照は禁止。
- 内容のある項目には要約参照、concreteには属性参照を必要とする。
- unknownは空の項目だけに使用し、属性参照を付けない。
出力: 指定Schemaに適合する修復結果のみ。`;

export function understandingSystem(stage: "extract" | "audit"): string {
  return [
    SYSTEM_INSTRUCTION,
    UNDERSTANDING_SOURCE_INSTRUCTION,
    UNDERSTANDING_COMPLETENESS_INSTRUCTION,
    ...(stage === "audit"
      ? [
          UNDERSTANDING_INFORMATION_INSTRUCTION,
          UNDERSTANDING_AUDIT_INSTRUCTION,
          UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION,
        ]
      : []),
  ].join("\n");
}
