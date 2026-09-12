export const SEMANTIC_AUDIT_POLICY = "semantic-integrity/v1.4.0";
export const SEMANTIC_AUDIT_SCHEMA_VERSION = "1.1";
const SEMANTIC_AUDIT_COMMON = `[TASK:SEMANTIC_AUDIT]
改訂後に実際に返す最終候補のラベル・描写・極性・条件・例外・要約を監査する。改訂前の候補を判定対象にしない。
[DEFINITIONS:PROPOSITION]
- 命題 := 誰について何を述べ、どの範囲で評価・否定するかを持つ内容。
- actor := 行為者。target := 行為・評価の対象。possessor := 所有・所属の主体。
- evaluatedProposition := 評価している命題。negatedProposition := 否定の作用域にある命題。
- 意味的支持 := 根拠が対象・極性・条件・例外を含む主張を裏付ける関係。原文に同じ文字列が存在することとは独立に判定する。
[OUTPUT_CONTRACT:SEMANTIC_AUDIT]
- 最終候補ごとにscopeAssessmentとevidenceSetAssessmentを付ける。
- 各evidenceにsupportAssessmentを付ける。
[PROCEDURE:SCOPE_ASSESSMENT]
1. 原文のactor・target・possessor・evaluatedProposition・negatedPropositionを区別する。該当しない人物・否定はnull。
2. anchorsに原文と入力Pointerまたは出典を付け、主体まで支持するか照合する。
3. 対象・所有・否定が最終候補全体と整合 → consistent。誤りが残る → mismatch。決定不能 → uncertain。reasonに具体的な理由を記録する。
4. 代名詞の照応は原文から解決できる範囲に限定する。未指定の行為者・相手を補わず、登録人物へ主語を置換しない。
5. ユーザーの経験・反応をキャラクターの行動・状態へ移さない。
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
1. 各引用の意味的支持を上記5値で判定する。名前・所属・媒体・時期の引用だけを行動・動機・関係の根拠にしない。
2. 複数の根拠で全体を支える場合、個々の引用はpartialのまま担当範囲をreasonに記録する。
3. evidenceSetAssessmentで根拠集合による最終主張全体への支持を同じ5値で判定する。reasonに結びつきと全体を支持する理由または不足を記録する。
4. evidenceIndexesに採用に必要な根拠の0始まりの参照番号を重複なく指定する。
5. 集合をsupportedとする条件: 有効な根拠1〜3件、個別判定がすべてsupportedまたはpartial、組合せが対象・極性・条件・例外のすべてを支持。単独で全体を支持する場合もその1件を指定する。
6. 根拠集合でも不足 → 同じ監査内で主張を支持範囲へ狭めて再判定。解消不能な部分的支持はpartialのまま保持する。
7. 照合可能な根拠がなくモデル知識のみ → evidenceSetAssessment=null。
[INVARIANTS:SEMANTIC_AUDIT]
- 引用の列挙だけで集合をsupportedにしない。
- 誤った対象・根拠のない主張を修正したら要約も一致させる。
- 人物解釈と公式の事実を区別する。`;

export const UNDERSTANDING_SEMANTIC_AUDIT_INSTRUCTION = `${SEMANTIC_AUDIT_COMMON}
[AUDIT_SCOPE:UNDERSTANDING]
- 人物像のassertionsのみ監査する。嗜好は分析しない。
- 明示されたモデル知識はsourceRef=model_knowledge、inferenceType=inferredとして独立に区別する。その根拠の意味判定はunverifiable、anchorsは空を許容する。
- 名前・媒体の引用を装飾的に付けてsource_explicitへ格上げしない。
- モデル知識の確信度を上げず、公開資料がないという理由だけで人物像を削除しない。
- 無効な出典をモデル知識へ読み替えない。
- 確定不能な人物描写を修正・除去し、summaryとuncertaintiesも一致させる。`;

export const PREFERENCE_SEMANTIC_AUDIT_INSTRUCTION = `${SEMANTIC_AUDIT_COMMON}
[AUDIT_SCOPE:PREFERENCE]
- evaluatedPropositionとnegatedPropositionで、対象への好悪とユーザーの反応の有無を分離する。
- 反応の否定だけをnegative属性の支持にしない。対象・極性を支持する命題を確認する。
- 確認済み人物理解は、ユーザーがその属性を好きだという根拠にしない。
- evidenceSetAssessmentに採用する根拠はすべてユーザー入力に限定する。
- モデル知識から好みを作らない。無効な出典をモデル知識へ読み替えない。
[UNRESOLVED:PREFERENCE_AUDIT]
- 確定不能な好み → uncertaintiesに理由と確認質問。原文に明示された好意自体はsummary.userExplicitSummaryに保持。
- 反応経路のみ未確定 → responseChannel=nullで候補を保持。`;
