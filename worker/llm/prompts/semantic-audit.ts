import { REFERENCE_SCOPE_INSTRUCTION } from "./reference-scope";

export const SEMANTIC_AUDIT_POLICY = "semantic-integrity/v1.7.0";
export const SEMANTIC_AUDIT_SCHEMA_VERSION = "1.1";
const SEMANTIC_AUDIT_COMMON = `[TASK:SEMANTIC_AUDIT]
改訂後の最終候補のラベル・描写・極性・条件・例外・要約を監査する。
[DEFINITIONS:PROPOSITION]
- 命題 := 主体・述語・評価／否定の範囲。
- actor := 行為者。target := 行為・評価の対象。possessor := 所有・所属の主体。
- evaluatedProposition := 評価している命題。negatedProposition := 否定の作用域にある命題。
- 意味的支持 := 対象・極性・条件・例外を含む主張の裏付け。文字列一致とは独立。inferredでも文脈が主張全体を支えればsupported。
[OUTPUT_CONTRACT:SEMANTIC_AUDIT]
- 最終候補にscopeAssessment・evidenceSetAssessmentを付ける。
- 各evidenceにsupportAssessmentを付ける。
[PROCEDURE:SCOPE_ASSESSMENT]
1. 原文のactor・target・possessor・evaluatedProposition・negatedPropositionを識別。非該当はnull。
2. anchorsに原文と入力Pointer／出典を付け、主体も照合する。
3. 対象・所有・否定が整合 → consistent。誤り → mismatch。決定不能 → uncertain。reasonに理由を記録。事実の裏付け不足は支持判定で扱う。
${REFERENCE_SCOPE_INSTRUCTION}
[BOUNDARY_EXAMPLES:SCOPE]
- 「妻子がいる人物Aが人物Bに接する」→ 妻子の所有者は人物A。
- 「二人を恋愛として読まない」→ 関係解釈の否定。ユーザー自身の恋愛感情の否定ではない。
- 「人物Aが認められる」→ 人物A本人への承認。関係性の公認ではない。
[DECISION_RULES:SUPPORT]
- supported := 主張全体を支持。
- partial := 主張の一部のみ支持。
- unsupported := 照合できるが支持なし。
- contradicted := 主張と矛盾。
- unverifiable := 原文・出典本文がなく照合不能。
[PROCEDURE:EVIDENCE_SUPPORT]
1. 各引用の支持を上記5値で判定。名前・所属・媒体・時期だけで行動・動機・関係を裏付けない。
2. 共同で支持する引用はpartialのまま担当範囲をreasonに記録する。
3. evidenceSetAssessmentで最終主張全体への集合的支持を同じ5値で判定。reasonに根拠の結びつきと支持範囲／不足を記録する。
4. evidenceIndexesに採用に必要な根拠の0始まりの参照番号を重複なく指定する。
5. 集合supportedの条件: 有効な根拠1〜3件がすべてsupportedまたはpartialで、対象・極性・条件・例外を共同で支持。単独支持でもその1件を指定する。
6. 根拠集合でも不足 → 同じ監査内で主張を支持範囲へ狭めて再判定。解消不能な部分的支持はpartialのまま保持する。
7. 照合可能な根拠がなくモデル知識のみ → evidenceSetAssessment=null。
[INVARIANTS:SEMANTIC_AUDIT]
- 引用の列挙だけで集合をsupportedにしない。
- 誤った対象・根拠のない主張を修正したら要約も一致させる。
- 人物解釈と公式の事実を区別する。`;

export const UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION = `${SEMANTIC_AUDIT_COMMON}
[AUDIT_SCOPE:UNDERSTANDING]
- 人物像のassertionsのみ監査し、嗜好は対象外。
- モデル知識はsourceRef=model_knowledge・inferenceType=inferred。支持判定はunverifiable、anchorsは空を許容する。
- 名前・媒体の引用を装飾的に付けてsource_explicitへ格上げしない。
- モデル知識の確信度を上げず、公開資料なしだけで人物像を削除しない。
- 無効な出典をモデル知識へ読み替えない。
- 確定不能な人物描写を修正・除去し、summaryとuncertaintiesも一致させる。`;

export const PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION = `${SEMANTIC_AUDIT_COMMON}
[AUDIT_SCOPE:PREFERENCE]
- ユーザー原文の評価・反応も照合し、根拠がある未抽出の対象・反応を補う。候補の有無で採否を決めない。
- evaluatedPropositionとnegatedPropositionで、対象への好悪とユーザーの反応の有無を分離する。
- 反応の否定だけをnegative属性の支持にしない。対象・極性を支持する命題を確認する。
- 支持の対象は原文のユーザー評価・反応。人物事実の証明を要求せず、文脈的解釈はinferred。
- evidenceSetAssessmentに採用する根拠はすべてユーザー入力に限定する。
- モデル知識から好みを作らない。無効な出典をモデル知識へ読み替えない。
[UNRESOLVED:PREFERENCE_AUDIT]
- 対象・極性が確定不能 → uncertaintiesに理由と確認質問。明示の好意はsummary.userExplicitSummaryに保持。
- 対象・極性・条件と反応を別判定する。反応だけ未確定ならresponseChannel=nullとし、反応を除いた命題のscope・個別根拠・根拠集合を再判定する。好意の対象を失わない。
- 改訂後も対象・極性・条件が支持されない場合はpartial等を維持する。根拠集合を無条件にsupportedへ変更しない。`;
