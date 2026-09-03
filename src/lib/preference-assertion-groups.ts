export type GroupablePreferenceAssertion = {
  id: string;
  raw_label: string;
  stable_key: string | null;
};

export type PreferenceAssertionGroup<T extends GroupablePreferenceAssertion> = {
  id: string;
  stableKey: string | null;
  label: string;
  items: T[];
};

export function normalizePreferenceLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ja-JP");
}

export function groupPreferenceAssertions<T extends GroupablePreferenceAssertion>(
  assertions: T[],
): PreferenceAssertionGroup<T>[] {
  const groups = new Map<string, PreferenceAssertionGroup<T>>();
  for (const item of assertions) {
    const normalizedLabel = normalizePreferenceLabel(item.raw_label);
    const key = item.stable_key ? `ontology:${item.stable_key}` : `raw:${normalizedLabel}`;
    const current = groups.get(key);
    if (current) {
      current.items.push(item);
      continue;
    }
    groups.set(key, {
      id: item.id,
      stableKey: item.stable_key,
      label: item.raw_label,
      items: [item],
    });
  }
  return [...groups.values()];
}
