import type { AnyGeneratedCharacterCandidate } from "../../../shared/contracts/generation";

export const settingSections = [
  ["identity", "人物像"],
  ["appearance", "外見"],
  ["personality", "性格"],
  ["valuesAndMorality", "価値観"],
  ["motivations", "動機"],
  ["abilitiesAndLimits", "能力と限界"],
  ["relationships", "関係性"],
  ["speech", "話し方"],
  ["narrativeRole", "役割"],
  ["characterArc", "変化"],
  ["darkCore", "ダーク状態"],
  ["baselineAndTransition", "闇化の契機"],
  ["darkMorality", "道徳論理"],
  ["darkRelationships", "ダークな関係性"],
  ["darkArc", "ダークな結末"],
  ["darkExpression", "ダークな表現"],
] as const;

export function feedbackSettings(character: AnyGeneratedCharacterCandidate) {
  const settings: Array<{ pointer: string; label: string }> = [];
  const visit = (value: unknown, pointer: string, label: string) => {
    if (typeof value === "string" && value.trim()) settings.push({ pointer, label: `${label}：${value.slice(0, 90)}` });
    else if (Array.isArray(value))
      value.forEach((item, index) => {
        visit(item, `${pointer}/${index}`, label);
      });
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`, label);
  };
  for (const [key, label] of settingSections)
    visit((character as unknown as Record<string, unknown>)[key], `/${key}`, label);
  return settings;
}
