import { understandingAspectLabels } from "../../../shared/understanding-aspects";
import { SYSTEM_INSTRUCTION } from "./analysis";
import { UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION } from "./semantic-audit";
export const UNDERSTANDING_INFORMATION_POLICY = "understanding-information/v1.4.0";

export const UNDERSTANDING_COMPLETENESS_INSTRUCTION = `キャラクター像の7項目（${Object.entries(
  understandingAspectLabels,
)
  .map(([key, label]) => `${key}: ${label}`)
  .join("、")}）をそれぞれ検討してください。
各項目には根拠のある人物像を具体的な文章で記述し、対応するassertionsにも根拠と出所を残してください。名前・作品名だけでは人物像は完成していません。
公開資料にないという理由だけで、利用可能なモデル知識を一律に削除しないでください。モデル知識はexplicitnessとsourceRefをmodel_knowledgeとし、確信度を上げずに扱ってください。
本当に不明な項目はsummaryを空配列にし、uncertaintiesにtopicをその項目の英語キー、reasonを具体的な不明理由として記録してください。「不明」や「確認できません」などの代替文はsummaryに入れないでください。
全項目を埋めるために設定を創作したり、ユーザーの嗜好を人物の事実へ転用したりしないでください。`;

export const UNDERSTANDING_INFORMATION_INSTRUCTION = `改訂後の人物像について、aspectAssessmentsで7項目すべての情報量を独立に監査してください。
kindはconcrete（具体的な人物描写）、label_only（分類名だけ）、attribution_only（出所・解釈についての注記だけ）、unknown（内容が空）です。項目ごとにreasonを具体的に述べ、改訂後の同じ項目のsummary配列へのsummaryIndexesと、改訂後のassertions配列へのassertionIndexesを0始まりの番号で返してください。
concreteには、その人物が何をする、何を目指す、何を重視する、誰とどう関わる、どう表現するかが分かる描写と、対応するassertionが必要です。分類名の要約でも参照先assertionに具体的な描写があればconcreteにできます。単なる名前・作品・媒体・時期の同定は人物描写に数えません。
「ヒーロー」「主人公」という役割名だけはlabel_only。「友達以上と読むのはユーザーの解釈であり公式設定ではない」という出所の注記だけはattribution_onlyです。ユーザー解釈でも「人物Aが人物Bの肩書きより本人を見て遠慮なく接する」のように具体的な関係を描写していれば、出所を区別してconcreteにできます。
複数項目への同じ注記の分散や、分類名の言い換えで具体性を増やさないでください。モデル知識は出所を保持し、公開資料にないという理由だけで削除しないでください。これは引用の正しさや事実の確実性の採点ではありません。
内容のある項目が1つ以下、またはconcreteが2項目未満なら補完対象になりますが、項目数を満たすための創作は禁止です。設定の少ない端役・創作人物・場面限定の対象は情報不足のままで構いません。対象の媒体・時期と、オリジナル・カスタムの入力範囲を守り、好みを人物の設定へ転用しないでください。`;

export const UNDERSTANDING_SOURCE_INSTRUCTION = `既成キャラクターの一般的な基本像は、システム収集済み公開情報と利用可能なモデル知識から構成してください。既成（カスタム）のbase stageではbaseCharacterNameを元キャラクターの名前として基本像を構成し、target stageではcharacterNameをカスタム後の名前として扱ってください。オリジナルキャラクターの一般的な基本像はcharacterBasicInfoから構成してください。referenceMaterialはユーザーが任意提供した補足情報、userCharacterViewはユーザー自身の解釈として、出所を混同しないでください。検索結果が対象と一致しない、情報が競合する、または根拠が弱い場合は断定せずlimitationsまたはuncertaintiesへ記録してください。
嗜好入力は意図的に含めていません。キャラクターの事実・解釈と、ユーザーが好きな属性を混同しないでください。`;

export const UNDERSTANDING_AUDIT_INSTRUCTION = `キャラクター理解候補を元資料と照合し、根拠のない断定・カスタム差分の誤りを訂正した完全な候補を返す。新しい事実や出典を創作せず、モデル知識の確信度を上げない。候補に含まれるモデル知識は公開資料に記述がないだけでは削除せず、対象との不一致や矛盾、知識自体の不確かさがある場合に修正する。削除で空になる項目には項目別の不明理由を残す。嗜好は分析しない。`;

export const UNDERSTANDING_COMPLETION_INSTRUCTION = `監査後の人物像に不足があります。元の登録情報を基準に再検討し、完全な候補を返してください。既成キャラクターでは利用可能な公開情報検索とモデル知識を用いて不足を補ってください。オリジナルやカスタム固有の設定は入力資料の範囲を守ってください。根拠が得られなければ項目別の不明理由を残してください。`;

export const UNDERSTANDING_ASSESSMENT_REPAIR_INSTRUCTION = `固定した人物像についてaspectAssessmentsだけを修復してください。人物像本体の追加・変更は禁止です。summaryIndexesは各項目内、assertionIndexesは属性一覧内の0始まりの番号です。重複や範囲外を返さず、内容のある項目に要約参照、concreteに属性参照が必要です。unknownは空の項目だけとし、属性参照を付けないでください。`;

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
