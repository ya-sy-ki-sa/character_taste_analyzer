export const PREFERENCE_REFINEMENT_INSTRUCTION = `[TASK:PREFERENCE_REFINEMENT]
質問への回答とユーザーが決定した仮説を追加入力として再分析する。
[INPUT_CONTRACT:REFINEMENT]
- 選ばれていない仮説と質問文だけを好みの根拠にしない。
- 仮説の選択はユーザーの好みの申告であり、人物の事実の証明ではない。
[PROCEDURE:REFINEMENT]
1. 好き・苦手を文章の意味から判定する。
2. 選択された仮説・回答に共通の属性粒度規則を適用する。
3. 結びつき・限定条件を含む選択を、構成要素それぞれへの無条件の好意へ拡張しない。
4. 独立要素が並列に選択されている場合は分割し、各候補に関係する条件のみ保持する。
[OUTPUT_CONTRACT:REFINEMENT]
既存の好みはシステムが別途保持する。重複を増やさず、追加の好みを返す。`;
