import { understandingAspectLabels } from "../../../shared/understanding-aspects";
import { SYSTEM_INSTRUCTION } from "./analysis";
export const UNDERSTANDING_INFORMATION_POLICY = "understanding-information/v2.3.0";

export const UNDERSTANDING_COMPLETENESS_INSTRUCTION = `[TASK:UNDERSTANDING_COVERAGE]
キャラクター像の7項目をそれぞれ検討する。
[ASPECTS]
${Object.entries(understandingAspectLabels)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n")}
[OUTPUT_RULES:UNDERSTANDING]
- 各項目に根拠のある人物像を具体的な文章で記述し、対応するassertionsに根拠・出所を保持する。名前・作品名だけを人物像の完成とみなさない。
- 同じ命題を区分ごとに別assertionとして再生成しない。1件のassertionを必要な複数区分から参照する。
- 複合主張に確認済み部分と未確認部分がある場合、根拠の異なる独立したassertionsに分割し、各部分の出所を混ぜない。
- ユーザー入力と公開資料に接地する候補を先に選び、各項目の接地済み候補は原則2件までに絞る。ただし、資料の引用や入力箇所を実際に示せない内容をsource_explicitとしない。
- 既成キャラクターの人物像は、資料に現れない項目も利用可能なモデル知識から具体的に検討する。接地候補がある項目でも別の有用な内容なら追加できる。各項目で最大2件、全体で最大10件を目安とし、重複や水増しはしない。モデル知識由来の主張にはexplicitness=model_knowledge、sourceRef=model_knowledgeを指定し、確認済み事実へ昇格させない。
- 既成キャラクターでは、7項目のうち人物・時期に即した別内容をできるだけ広く残す。役割・道徳・目標だけで終えず、価値観・行動・関係・表現も検討する。十分に知らない項目は創作しない。オリジナルやカスタム固有設定は入力範囲を超えて補わない。
- モデル知識は未照合として扱い、断定を避ける。公開資料にないという理由だけで有用な未照合候補を一律削除しない。同じ命題に接地済み候補があればモデル知識版を作らない。
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
入力: 欠落している人物像項目、残り補完予算、保持済みの人物描写、利用可能な入力Pointerと出典、元の登録情報。
指定された欠落項目を1巡だけ再検討する。改訂案は再び意味判定へ渡される。
処理:
1. 元の登録情報を基準に不足項目を再検討する。
2. 既成キャラクターは入力・公開資料の根拠を優先して補完する。引用を実際に示せない有用な描写はモデル知識由来として、指定された項目別・全体の残り予算内で追加する。すでに根拠付きの内容がある項目でも、同義でない別の人物像なら追加できる。
3. オリジナル・カスタム固有の設定は入力資料の範囲を保持する。
4. 根拠を取得できない項目には項目別の不明理由を残す。
5. 保持済みのassertionを維持する。欠落項目以外のassertionやsummaryを再生成・増補しない。過去の削除理由から断定を再生成せず、利用可能な出典が支持する範囲だけを追加する。項目数を埋めるための創作は禁止。
出力: 指定Schemaに適合する完全な候補。`;

export function understandingSystem(): string {
  return [SYSTEM_INSTRUCTION, UNDERSTANDING_SOURCE_INSTRUCTION, UNDERSTANDING_COMPLETENESS_INSTRUCTION].join("\n");
}
