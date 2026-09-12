import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { responseChannelPrompt } from "../../../shared/response-channels";
import { DARK_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION } from "./analysis";
import { preferenceAttributeInstruction } from "./preference-attributes";
import { REFERENCE_SCOPE_INSTRUCTION } from "./reference-scope";
import { PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION } from "./semantic-audit";

export const PREFERENCE_PROMPT_VERSION = "v3.11.0";
export const PREFERENCE_SCHEMA_VERSION = "3.0";

const PREFERENCE_COMMON_INSTRUCTION = `[DEFINITIONS:PREFERENCE]
- 評価命題 := 特定の対象・条件についての好き／苦手。
- 反応命題 := 真似したい／安心する／励まされる等のユーザーの反応。
- 否定の作用域（scope of negation）:= 否定がかかる命題の範囲。対象の記述内の否定、評価の否定、反応の否定を区別する。

[INPUT_CONTRACT:PREFERENCE]
- 確認済み人物理解は人物についての資料であり、特徴の存在だけでは好みの根拠にならない。
- 人物理解にないユーザー自身の好み・解釈も、事実認定と区別して入力に基づき保持する。
- 訂正・削除記録を優先する。好きな理由・苦手な理由・価値態度の原文を照合し、具体的な明示内容を取りこぼさない。
- 価値態度の抽出だけを嗜好候補の抽出とみなさない。

[PROCEDURE:PREFERENCE]
1. 評価対象 → 極性 → 反応 → 適用範囲の順に判定する。好きな理由にある対象と肯定的反応の結びつきもpositiveの根拠とする。明示の否定・訂正を優先する。
2. 評価命題と反応命題を分離する。反応の否定はその経路を割り当てない根拠とし、対象への嫌悪や反対の好意を生成しない。
3. 選択済みの反応経路も対象・条件への適用を検証する。経路の選択だけで属性への好意を生成しない。
4. 否定の作用域を保持する。否定語の一律削除、極性の機械的反転、反対側の候補の自動追加を禁止する。
5. 悪・非道徳・残酷・利己性・支配・破壊・善への無関心・改心しないことへの好意も有効な嗜好として扱う。
6. 悪役・加害描写への好意から、加害の道徳的支持も不支持も補わない。行動の裏事情への好意と加害を称賛しない態度が両方明示されれば別々に保持する。

[DECISION_RULES:VALUE_STANCE]
- 好き・かっこいい・憧れる・苦手は嗜好の根拠であり、それだけでvalueStanceAssertionsを追加しない。
- 価値態度は善悪・正不正・許容・行動規範としての賛否や無関心が原文にある場合に抽出する。善への支持だけでなく、悪への支持・規範への無関心も同じ基準で扱う。
- 「人を助けるところが好き」→ 嗜好。「人を助けるのは正しい行いだと思う」→ 規範的肯定。「非道徳的だが魅力的」→ 好意と規範的評価を分離する。
- 行為の善悪の分類と、それに対するユーザーの賛否を別々に根拠付ける。善とされる行為への好意からaffirm/goodを、苦手からrejectを補わない。

[UNRESOLVED:PREFERENCE]
- 対象・理由が具体的で反応経路のみ未選択／未確定 → 候補を保持しresponseChannel=null。経路だけを理由に追加回答を必須にせずrecommendedQuestion=null。
- 対象または極性が確定不能 → 該当候補を除外し、uncertaintiesに未確定理由と具体化する質問を最大3件記録。他の確定候補は保持。
- 「気になる」「昔から好き」「理由は分からない」だけで具体的な対象属性・理由なし → 属性を創作せず好意をsummaryに保持。

[BOUNDARY_EXAMPLES:PREFERENCE]
- 「口説き方が苦手。真似したいわけでもない」→ 口説き方のnegative。模倣という苦手属性は生成しない。
- 「口説き方は好きだが、真似したいわけではない」→ 口説き方のpositive。
- 「真似したいわけではない」のみ → 対象への好悪は未確定。
- 「改心しないところが好き」→ 改心しない状態のpositive。
- 「支配する側とされる側には見たくない」→ 支配関係として固定する解釈のnegative。「固定されない関係」のnegativeにしない。一方的な服従への苦手が別途明示されれば別候補。
- 「好きとは限らない」「恐怖だけが好きなわけではない」→ 嫌悪を確定しない。`;

const STANDARD_REACTION_INSTRUCTION = `[DEFINITIONS:RESPONSE_CHANNEL]
${responseChannelPrompt()}

[DECISION_RULES:STANDARD_REACTION]
- 許可値の意味は上記の日本語定義に従う。英語名や「かっこいい」等の語だけで分類しない。
- aesthetic_likingは外見・衣装・色・造形への評価。行動・生き方のかっこよさには割り当てない。
- character_craft_appreciationは設定・脚本・描写の組み立てへの評価。主体性・努力・能力への好意だけには割り当てない。
- admirationは能力・生き方・姿勢への高い評価。「憧れる」だけではwishful_identificationを追加しない。
- wishful_identification := 人物の姿勢・性質を自分も身につけたい願望。主体はユーザー。人物全体への同一化や同一行動の逐語的一致は不要。
- actual_similarity := 主観的な自己照合。人物側とユーザー側の特徴・経験を特定 → 原文が結び付ける共通部分を抽出 → その範囲だけをrawLabel・contextに残す。「自分も…だから」という理由づけもinferredの根拠とし、「似ている」の明記を要求しない。
- 共通部分が候補の一部なら、努力・能力・心理等の未支持部分を外して再判定する。自己経験の併記だけ、照合先不明、人物全体への拡張は不可。
- 「真似したいわけではない」「似ているとは思わない」という反応の否定を優先する。元の対象への好意は別に判定する。

[BOUNDARY_EXAMPLES:STANDARD_REACTION]
- 「怖くても助ける姿に憧れる」→ admiration。「自分も怖くても助けられるようになりたい」→ wishful_identification。
- 「失敗しても再挑戦する姿が好き。自分も失敗が多いから励まされる」→ 失敗経験へのactual_similarityと再挑戦へのmotivation。ユーザーにも再挑戦する性質があるとは補わない。
- 「再挑戦する姿が好き。自分も部活をしているが似ているとは思わない」→ 自己類似を追加しない。
- 「衣装の配色が好き。台詞の反復で成長を描く脚本が巧い」→ 外見評価と作劇評価をそれぞれ保持する。`;

const PREFERENCE_CONTEXT_INSTRUCTION = `[PROCEDURE:CONTEXT]
1. 人物の事実とユーザーの解釈・仮定を区別する。
2. 過去の憧れを現在の願望へ、仮定の苦手条件を人物の事実へ変換しない。限定された苦手を一般的な苦手へ拡張しない。

[OUTPUT_MAPPING:CONTEXT]
- subjects := その候補に関係する主体。
- relationships・conditions := 根拠にある行為者・相手・関係・条件。
- narrativePhases := 作中の時期。
- conditions := ユーザーが好んだ時期（子どもの頃／現在）を含む適用条件。
- exceptions := 除外条件。

[BOUNDARY_EXAMPLES:CONTEXT]
- 「友情以上」→ ユーザーの関係解釈。公式の恋愛関係やユーザー自身の恋愛感情に変換しない。
- 声をきっかけに友人との記憶を想起 → 声質への好みやノスタルジーを断定しない。
- 冷たい性格だけで終わる場合への苦手 → 不変性全般への苦手に拡張しない。`;

const PREFERENCE_SCORING_INSTRUCTION = `[SCORING:STRENGTH]
- strength := その対象・条件に表明された好意または苦手の強さ。positive/negativeにかかわらず強い反応ほど高い。
- 目安: 弱い反応=0.3、通常の好き／苦手=0.6、強い反応=0.8、最も強いと明示=0.95。
- 程度指定なし → 基準0.6。
- 文章量・引用数・属性の珍しさ・他キャラクターでの頻度による増額を禁止する。

[SCORING:CONFIDENCE]
- confidence := 対象・極性・条件を含む嗜好解釈が根拠に支持される確かさ。好意の強さや人物設定の真偽とは独立。
- 目安: 直接明示=0.9、意味の補足解釈が必要=0.7、根拠からの推測=0.5。
- 反応経路のみ未確定 → 減額しない。
- 対象・極性が確定不能 → 低得点の候補として保持せずuncertaintiesへ移す。
- 推測はinferredを維持する。高得点を理由に明示へ格上げしない。
- valueStanceAssertionsのconfidenceにも同じ根拠の確かさの基準を適用する。`;

const PREFERENCE_STRUCTURE_INSTRUCTION = `[OUTPUT_MAPPING:PREFERENCE]
- 候補の意味 := 属性・極性・適用条件・反応の組。
- rawLabel := 評価対象の中心を表す共通概念の属性名。
- polarity := 評価の正負。
- responseChannel := 反応の種類。
- context := 必要な人物・場面・条件・例外。
- evidence := 改変しない原文引用と正しい入力Pointer。
- attributeStableKey := 意味・粒度・評価範囲が一致する許可済み辞書キー。対応なし → attributeStableKey=nullと一般化したrawLabel。
- valueStanceAssertions.targetRef := 許可された既存属性キー、または日本語の具体的な対象名。未知のキーは生成しない。

[INVARIANTS:PREFERENCE_OUTPUT]
- contextと引用を属性ごとに選択する。全人物・全場面・全条件を全候補へコピーしない。
- 同じ属性でも条件により正負が異なる場合は別候補とし、mixedへ集約しない。
- 引用を共有する場合も、各候補の対象・極性・条件をそれぞれ支持すること。
- 反応ごとに支持される対象範囲を先に確定する。対象と成立条件が一致する候補だけattributeStableKeyとrawLabelを揃える。
- 反応経路・適用範囲の意味ある違いは保持する。語句の類似だけによる統合、候補間の条件の補完を禁止する。
- 相互選択・特別さを競争だけへ置換しない。
- 固有名詞・具体的な元表現はevidenceと必要なcontextに保持する。一般化した属性とcontextの組が引用に支持されれば、rawLabelと原文の文字列一致は不要。
- 一般概念が確定不能 → 名前入りの属性を返さず、要約や不確実性に残す。
- 最終候補の対象・極性・条件と要約を一致させる。

[BOUNDARY_EXAMPLES:PREFERENCE_OUTPUT]
- 「傲慢な人物が従属させられる落差が好き」→ rawLabelに傲慢な人物の従属化を保持。具体的な人物・場面はcontext。
- 「現実から切り離された闇の支配展開への没入が好き」→ rawLabelは支配的な展開、responseChannelは没入に対応する許可済み値、contextは現実から切り離して鑑賞する条件。
- 「工夫そのものが好き。低身長を補う工夫も好き」→ 工夫自体と低身長を補う工夫は評価範囲が異なるため統合しない。`;

export function preferenceInstruction(domain: AnalysisDomain): string {
  const domainInstruction =
    domain === "dark"
      ? `[DOMAIN:DARK_PREFERENCE]
- ダーク領域に限定する。対象のダーク性・ダーク状態・変化差分と好みの結びつきが根拠にある候補のみ保持する。
- 元キャラクター自体への一般嗜好を含めない。
- 専用反応経路のみ使用し、決定不能ならnull。
- 辞書外のダーク属性は一般化したrawLabelとattributeStableKey=nullで保持する。`
      : `[DOMAIN:STANDARD_PREFERENCE]
- 通常版の反応経路のみ使用する。
- 身体特徴・服装・装身具への好みも単独属性として抽出する。
- 「銀髪が好き。ただし冷淡な人物に限る」→ rawLabel=銀髪、polarity=positive、context.conditions=冷淡な人物に限る。冷淡さへの好意を自動追加しない。`;
  return `${preferenceAttributeInstruction(domain)}\n${PREFERENCE_COMMON_INSTRUCTION}\n${PREFERENCE_CONTEXT_INSTRUCTION}\n${PREFERENCE_STRUCTURE_INSTRUCTION}\n${PREFERENCE_SCORING_INSTRUCTION}\n${domainInstruction}`;
}

export function preferenceSystem(domain: AnalysisDomain, stage: "extract" | "audit"): string {
  const task =
    stage === "extract"
      ? `[TASK:PREFERENCE_EXTRACT]
- 確認済み人物理解とユーザー入力を分離し、嗜好候補を抽出する。
- キャラクターが持つ全属性を自動で好きにしない。
- 未選択の反応経路の推定にも、好きな理由の根拠を必要とする。
- 根拠不足による候補0件は正常な結果とする。`
      : `[TASK:PREFERENCE_AUDIT]
- 嗜好候補を独立監査し、要約を含む完全な改訂結果を返す。
- 人物理解の訂正は事実認定に適用する。原文の好み・仮定・願望は別に評価する。
[PROCEDURE:PREFERENCE_AUDIT]
1. 全候補の粒度を判定する。独立要素の分割、背景・条件・反応の移動、結びつき自体を評価する複合属性の保持を適用する。
2. 根拠が十分でも複数要素を一括採用しない。短いラベルでも粗すぎる一般化は修正する。根拠集合の支持と粒度の適切さを独立に判定する。
3. 候補間で評価対象・成立条件・名称を照合し、反応経路の違いと対象の違いを区別する。
4. 根拠を原文と再照合する。根拠のない推定、条件・反応経路の拡大、反応の否定からの好悪生成、ユーザー経験の人物事実への転用を除去する。
5. 固有名詞、辞書との意味的一致、対象領域、条件の混在を点検する。推測をuser_explicitへ格上げしない。`;
  return [
    domain === "dark" ? DARK_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION,
    preferenceInstruction(domain),
    ...(domain === "standard" ? [STANDARD_REACTION_INSTRUCTION] : []),
    task,
    domain === "standard" && stage === "audit" ? PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION : REFERENCE_SCOPE_INSTRUCTION,
  ].join("\n");
}
