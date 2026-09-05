import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import { entryPreferenceContext } from "../../../shared/entry-input";
import type { EntryContext } from "./types";

export function refinementInstruction(entry: EntryContext): string {
  if (!entry.refinement) return "根拠不足なら候補0件とし、追加質問をuncertaintiesへ記載する。";
  if (entry.refinement.mode === "hypotheses")
    return "ユーザーは仮説の提示を選択した。確認済み理解から異なる反応を想定した最大3件の仮説候補を提示する。必ずinferred、confidence <= 0.35とし、明示的好みとして断定しない。候補の確認後にだけ集計する。";
  return `次の質問への回答と、ユーザーが決定した仮説だけを追加入力として再分析する。選ばれていない仮説を好みの根拠にしない。選択はユーザーの好みの申告であって人物の事実の証明ではない。好き・苦手を文章の意味で区別し、質問文だけを根拠にしない。既存の好みは別途保持されるので重複を増やさず、追加の好みを返す。既存の好み: ${JSON.stringify(entry.retainedPreferences ?? [])}。許可Pointer: ${JSON.stringify(entry.refinement.answers.map((_, index) => `/preference/clarifications/${entry.refinement?.id}/${index}`))}`;
}

export function preferenceContextFor(payload: AnyEntryDraft) {
  return {
    schemaVersion: "2" as const,
    entryScope: entryPreferenceContext(payload) ?? null,
    subjects: [],
    relationships: [],
    narrativePhases: [],
    conditions: [],
    exceptions: [],
  };
}

export function inputEvidence(
  pointer: string,
  quote: string | null,
  inferenceType: "direct" | "paraphrase" | "inferred",
) {
  return [
    {
      sourceRef: `input:${pointer.slice(1)}`,
      sourceUrl: null,
      inputPointer: pointer,
      quote,
      inferenceType,
    },
  ];
}

export function modelKnowledgeEvidence() {
  return [
    {
      sourceRef: "model_knowledge",
      sourceUrl: null,
      inputPointer: null,
      quote: null,
      inferenceType: "inferred" as const,
    },
  ];
}
