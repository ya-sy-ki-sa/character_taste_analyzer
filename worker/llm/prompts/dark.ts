import { DARK_SYSTEM_INSTRUCTION } from "./analysis";

export const DARK_SCOPE_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
この登録がダークキャラ嗜好ラボの対象か判定してください。善側の人物でも、洗脳・憑依・操作・堕落・裏切り・敵対化している限定状態なら対象です。単なる悲劇、一般的な強さ、美しさだけでは対象にしません。`;

export const DARK_BASELINE_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
既成（カスタム）の元キャラクターを、堕落前比較用のベースラインとして理解してください。通常の嗜好属性やダーク属性へmappingせず、役割、主体性、道徳的約束、守る対象、関係、能力・責務、自己認識、元からの危うさだけを抽出してください。対象状態の嗜好は含めません。人物の事実・解釈とユーザーの好みを分け、好みは抽出しないでください。`;

const DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION = `辞書キーは許可済みのdark.*だけを使用し、対応のないダーク属性はattributeStableKey=nullで保持できます。一般属性は単独で出力しないでください。`;

export const DARK_UNDERSTANDING_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
対象のダーク状態を専用Ontologyで分析してください。${DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION}主体性、同意、認識、抵抗、自我、責任、可逆性と時系列を明示し、ベースラインがある場合はretained/amplified/suppressed/inverted/removed/introduced/ambiguousの差分を作ってください。人物の事実・解釈とユーザーの好みを分け、好みは抽出しないでください。`;

export const DARK_UNDERSTANDING_AUDIT_SYSTEM = `${DARK_SYSTEM_INSTRUCTION}
${DARK_UNDERSTANDING_ATTRIBUTE_INSTRUCTION}
次の候補を監査し、根拠のない断定を削除またはunknownへ下げた完全な改訂候補を返してください。新しい事実やURLを追加してはいけません。役割と道徳性、通常時と闇状態、本人の意思と外部支配、元からの特徴と後付け特徴を混同せず、不要な善化・悲劇化・贖罪・処罰を追加しないでください。人物の事実・解釈とユーザーの好みを分け、好みは抽出しないでください。`;
