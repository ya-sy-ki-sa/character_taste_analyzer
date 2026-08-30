const stableKeyPattern = /^[a-z0-9_.-]+$/u;

export function localizeAttributeReference(value: string, labels: ReadonlyMap<string, string>): string {
  const normalized = value.trim();
  return (
    labels.get(normalized) ?? (stableKeyPattern.test(normalized) && normalized.includes(".") ? "未分類の属性" : value)
  );
}

function localizeStableKeyText(value: string, labels: ReadonlyMap<string, string>): string {
  const normalized = value.trim();
  const exactLabel = localizeAttributeReference(value, labels);
  if (exactLabel !== value) return exactLabel;

  const tokens = normalized.split(/\s*[,、]\s*/u);
  if (tokens.length < 2 || !tokens.every((token) => stableKeyPattern.test(token))) return value;

  return tokens.map((token) => labels.get(token) ?? "未分類の属性").join("、");
}

/**
 * Converts ontology stable keys in an understanding summary to presentation labels.
 * Stored analysis data remains unchanged, and unknown internal keys use a generic Japanese label.
 */
export function localizeUnderstandingSummary(
  summary: Record<string, unknown>,
  labels: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => {
      if (typeof value === "string") return [key, localizeStableKeyText(value, labels)];
      if (Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === "string" ? localizeStableKeyText(item, labels) : item))];
      }
      return [key, value];
    }),
  );
}
