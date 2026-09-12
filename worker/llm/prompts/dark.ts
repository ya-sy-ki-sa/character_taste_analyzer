import { DARK_SYSTEM_INSTRUCTION } from "./analysis";

export const DARK_SCOPE_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
[TASK:DARK_SCOPE]
登録がダークキャラ嗜好ラボの対象かを判定する。
[DECISION_RULES:DARK_SCOPE]
- 入力にダーク文脈がある元からの悪・非道徳的な人物、ヴィラン、敵対的ライバル、反英雄、ダークヒーロー、道徳的に曖昧な人物 → 対象。
- 善側の人物の洗脳・憑依・操作・堕落・裏切り・敵対化した限定状態 → 対象。
- 善から悪への変化は必須条件にしない。
- 単なる悲劇、一般的な強さ、美しさだけ → 対象にしない。`;

export const DARK_BASELINE_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
[TASK:DARK_BASELINE]
既成（カスタム）の元キャラクターを、対象状態と比較する基準状態（ベースライン）として構造化する。
[EXTRACTION_SCOPE:DARK_BASELINE]
- 役割、主体性、道徳的約束、守る対象、関係、能力・責務、自己認識、元からの危うさのみ抽出する。
- 元からの悪・非道徳性を保持する。善良な過去・堕落を前提にしない。
- 通常の嗜好属性・ダーク属性へのmappingを行わない。
- 人物の事実・解釈とユーザーの好みを分離する。対象状態の嗜好を含め、好みを抽出しない。`;

const DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION = `[ONTOLOGY:DARK_UNDERSTANDING]
- Ontology := この処理に提示されたダーク領域の概念体系と許可済み辞書キー。
- 辞書キーは許可済みのdark.*のみ使用する。
- 対応のないダーク属性はattributeStableKey=nullで保持する。
- 一般属性は単独で出力しない。`;

export const DARK_UNDERSTANDING_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
[TASK:DARK_UNDERSTANDING]
対象のダーク状態を専用Ontologyで分析する。
${DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION}
[PROCEDURE:DARK_UNDERSTANDING]
1. 主体性・同意・認識・抵抗・自我・責任・可逆性と時系列を明示する。
2. ベースラインがある場合は特徴ごとに差分を判定する。
3. 人物の事実・解釈とユーザーの好みを分離する。好みを抽出しない。
[DEFINITIONS:TRANSITION]
retained=保持、amplified=増幅、suppressed=抑制、inverted=反転、removed=消失、introduced=導入、ambiguous=差分を確定不能。
[UNRESOLVED:DARK_UNDERSTANDING]
- 元から悪・非道徳的な人物も対象とする。
- 変化の根拠なし → 闇化前の状態・契機を創作しない。
- 該当しない状態 → Schemaに従ってnull。`;

export const DARK_UNDERSTANDING_AUDIT_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
[TASK:DARK_UNDERSTANDING_AUDIT]
候補を監査し、根拠のない断定を削除またはunknownへ下げた完全な改訂候補を返す。
${DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION}
[INVARIANTS:DARK_UNDERSTANDING_AUDIT]
- 新しい事実・URLを追加しない。
- 役割／道徳性、通常時／闇状態、本人の意思／外部支配、元からの特徴／後付け特徴を分離する。
- 不要な善化・悲劇化・贖罪・処罰を追加しない。
- 元から悪・非道徳的な人物に、根拠のない善良な過去・闇化契機を補わない。
- 人物の事実・解釈とユーザーの好みを分離する。好みを抽出しない。`;
