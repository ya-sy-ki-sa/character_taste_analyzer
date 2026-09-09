import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { DARK_SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION } from "./analysis";
import { preferenceAttributeInstruction } from "./preference-attributes";
import { PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION } from "./semantic-audit";

export const PREFERENCE_PROMPT_VERSION = "v3.4.0";
export const PREFERENCE_SCHEMA_VERSION = "3.0";

const PREFERENCE_COMMON_INSTRUCTION = `好みの対象・理由と反応経路を別々に判断してください。
対象・理由が具体的に明示されていれば、response channelが未選択・未確定でも嗜好候補を保持し、判断できないresponseChannelだけをnullにしてください。経路が不明という理由で好み自体のconfidenceを下げないでください。選択された経路も対象・条件に適用できるか確認し、経路選択だけから属性への好意を作らないでください。
好きな理由・苦手な理由・価値態度の原文を候補と照合し、抜けている具体的な明示内容を復元してください。価値態度が存在しても好みの候補を抽出できたことにはなりません。根拠には原文の引用と正しい入力Pointerを使ってください。
確認済み人物理解に属性がなくても、ユーザー自身の好み・解釈は入力に基づき保持できます。事実認定と混同せず、訂正・削除記録は尊重してください。対応する辞書属性がなければattributeStableKey=nullと固有名詞を含まない一般化したrawLabelを使ってください。
行動の裏事情への好意と加害を称賛しない態度は別々に保持してください。「友情以上」はユーザーの関係解釈としてcontextに保持し、公式の恋愛関係やユーザー自身の恋愛感情へ変換しないでください。声をきっかけに思い出す友人との記憶と現在の好意から、声質への好みやノスタルジーを断定しないでください。条件・例外・否定を省略しないでください。
「気になる」「昔から好き」「理由は分からない」だけで具体的な対象属性・理由がないときは、好意をsummaryに残し、属性を創作せず具体化する質問を最大3件返してください。対象・理由が具体的で反応経路だけが未確定の場合は、追加回答を必須にせずrecommendedQuestionをnullにしてください。
否定・対象・条件は原文の命題単位で確認します。誰が、誰に、何をする／どの状態になることへの評価なのかを確定し、rawLabel・polarity・context・要約が同じ意味を表すか、照合してください。引用の文字列が存在することと、引用がその意味を支持することは別です。
「支配する側とされる側には見たくない」「支配や一方的な服従として描く解釈は苦手」なら、対象は「支配・一方的服従として固定する描写」、polarity=negativeです。「固定されない関係」をnegativeにすると反転します。反対側のpositive候補を自動追加しないでください。「改心しないところが好き」は改心しない状態へのpositiveです。否定語の一律削除・極性反転は禁止します。「好きとは限らない」「恐怖だけが好きなわけではない」から嫌悪を確定しないでください。
subjectsには関係者を列挙し、relationships・conditionsには「誰が誰に何をするか」を名前付きで記述してください。登録人物へ主語や目的語を自動置換せず、代名詞を同じ人物に解決してください。例：「人物Aが人物Bの肩書きより本人を見て接する」では、見る側は人物A、見られる本人は人物Bです。要約でもこの向きを保持してください。
恐怖を抱えながら仲間へ関わることへの好意を恐怖単独への好意へ広げず、冷たい性格だけで終わる場合への苦手を不変性全般への苦手へ広げないでください。作中の時期はnarrativePhases、ユーザーが好んだ時期（子どもの頃／現在）はconditionsへ分け、exceptionsに除外条件を保持してください。過去の憧れを現在の願望に変換しないでください。「昔は憧れた」だけで現在の同一化願望を補わず、対応を確定できなければnullにしてください。
標準属性へ対応づけても具体的な元表現はevidenceの原文引用とcontextに保持し、rawLabelは共通概念の属性名にしてください。相互選択・特別さを競争だけに置換しないでください。valueStanceAssertions.targetRefは許可された既存属性キー、または日本語の具体的な対象名にし、未知の属性キーを捏造しないでください。
要約も候補と一致させてください。対象・極性の意味を確定できない候補は出力候補から外し、入力に明示された好意をsummaryに残して、uncertaintiesへ未確定理由と具体的な質問を記録してください。他の確定した候補は保持します。反応経路だけが未確定の場合はこの除外を適用せずnullのまま保持してください。`;

const PREFERENCE_EVIDENCE_INSTRUCTION = `人物理解に存在するだけで好みを述べていない特徴は追加しないでください。各候補がユーザーの好みの根拠で支持されることを確認してください。
固有名詞と具体的な元表現はevidenceの原文引用とcontextへ保持し、引用自体を書き換えないでください。一般概念を確定できない場合は名前入りの属性を返さず、要約や不確実性に残してください。具体的な引用が一般化した属性とcontextの組を支持するか確認し、名称が原文と一字一句同じでないことだけを理由に除外しないでください。
反応の種類はresponseChannel、適用範囲はcontextに分けます。没入だけから支配行為への道徳的支持を追加しません。各候補に必要な共通条件と引用を引き継ぎ、対象、極性、条件、例外、明示性、反応経路を再確認してください。
悪、非道徳、残酷、利己性、支配、破壊、善への無関心、改心しないことへの好意を有効な嗜好として保持し、穏当な理由へ置換しないでください。明示的な仮定の苦手条件も人物の事実とは分けて保持し、人物への好意を行為への支持にしないでください。`;

export function preferenceInstruction(domain: AnalysisDomain): string {
  const domainInstruction =
    domain === "dark"
      ? "ダーク領域に限定した嗜好を扱います。元キャラクター自体への一般嗜好を含めず、対象状態・変化差分とユーザーの好みの結びつきが根拠にある候補だけを保持してください。専用反応経路だけを使い、決められなければnullにしてください。辞書に対応しないダーク属性は一般化したrawLabelとattributeStableKey=nullで保持できます。"
      : "通常版の反応経路だけを使ってください。憧れが明示される場合のadmirationと、その人物のようになりたいwishful_identificationを区別してください。身体特徴・服装・装身具への好みも単独属性として取りこぼさないでください。";
  return `${preferenceAttributeInstruction(domain)}\n${PREFERENCE_COMMON_INSTRUCTION}\n${PREFERENCE_EVIDENCE_INSTRUCTION}\n${domainInstruction}`;
}

export function preferenceSystem(domain: AnalysisDomain, stage: "extract" | "audit"): string {
  const task =
    stage === "extract"
      ? "確認済み人物理解とユーザー入力を分け、嗜好候補を抽出してください。キャラクターが持つ全属性を自動で好きにせず、未選択の反応経路を推定する場合も好きな理由の根拠を必要とします。根拠不足の候補0件は正常です。"
      : "嗜好候補を独立監査し、要約も含む完全な改訂結果を返してください。訂正済み理解を優先し、削除済み特徴を原資料から復活させないでください。根拠のない推定や、条件・反応経路の拡大を除去し、推測をuser_explicitへ格上げしないでください。固有名詞、属性の粒度、並列要素の分割、辞書との意味的一致、対象領域を全候補で確認・修正してください。";
  return [
    domain === "dark" ? DARK_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION,
    preferenceInstruction(domain),
    task,
    ...(domain === "standard" && stage === "audit" ? [PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION] : []),
  ].join("\n");
}
