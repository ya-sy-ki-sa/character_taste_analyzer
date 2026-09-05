/** Read saved context without inventing missing conditions or changing stored aggregation keys. */
export function preferenceContextRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return preferenceContextRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function preferenceContextEntries(value: unknown): Array<[string, string]> {
  const context = preferenceContextRecord(value);
  const fields = [
    ["entryScope", "対象範囲"],
    ["scope", "対象範囲"],
    ["freeText", "対象範囲"],
    ["subjects", "対象人物"],
    ["relationships", "関係"],
    ["narrativePhases", "物語上の時期"],
    ["conditions", "条件"],
    ["exceptions", "例外・除外"],
  ] as const;
  const entries: Array<[string, string]> = [];
  for (const [key, label] of fields) {
    const raw = context[key];
    const text =
      typeof raw === "string"
        ? raw.trim()
        : Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("、")
          : "";
    if (text && !entries.some(([existingLabel, existingText]) => label === existingLabel && text === existingText))
      entries.push([label, text]);
  }
  return entries;
}

export function preferenceContextLabel(value: unknown): string {
  return preferenceContextEntries(value)
    .map(([label, text]) => `${label}：${text}`)
    .join(" ／ ");
}

/** Legacy unknown keys remain identities; display only descriptions already stored with them. */
export function preferenceTargetLabel(target: string, labels: ReadonlyMap<string, string>, scope?: unknown): string {
  const key = target.trim();
  const known = labels.get(key);
  if (known) return known;
  if (!/^[a-z0-9_.-]+$/u.test(key) || !key.includes(".")) return target;
  const context = preferenceContextRecord(scope);
  const relationships = Array.isArray(context.relationships)
    ? context.relationships.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  return relationships.length ? relationships.join("、") : "対象未確認";
}
