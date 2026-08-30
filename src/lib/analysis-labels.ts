import { responseChannelLabel } from "../../shared/response-channels";

const explicitnessLabels: Readonly<Record<string, string>> = {
  source_explicit: "原典・資料に明記",
  source_interpreted: "原典・資料から解釈",
  user_explicit: "ユーザーが明示",
  user_confirmed: "ユーザーが確認済み",
  inferred: "入力から推定",
  model_knowledge: "モデル知識による推定",
};

export function explicitnessLabel(value: string): string {
  return explicitnessLabels[value] ?? "根拠区分未分類";
}

export function evidenceQuoteLabel(value: string, inputPointer: string | null): string {
  if (inputPointer !== "/preference/responseChannels") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") return responseChannelLabel(parsed);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed.map((item) => responseChannelLabel(item)).join("、");
    }
  } catch {
    // The verifier may store a plain string rather than its JSON representation.
  }
  return responseChannelLabel(value.replace(/^[「『"']|[」』"']$/gu, "").trim());
}
