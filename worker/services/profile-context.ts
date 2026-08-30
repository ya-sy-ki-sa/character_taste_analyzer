function canonicalJson(input: string): string {
  try {
    const sort = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sort);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, sort(nested)]),
        );
      }
      return value;
    };
    return JSON.stringify(sort(JSON.parse(input)));
  } catch {
    return "{}";
  }
}

export function profileConditionJson(contextJson?: string | null): string {
  if (!contextJson) return "{}";
  try {
    const context = JSON.parse(contextJson) as Record<string, unknown>;
    return context.schemaVersion === "2" ? canonicalJson(contextJson) : "{}";
  } catch {
    return "{}";
  }
}
