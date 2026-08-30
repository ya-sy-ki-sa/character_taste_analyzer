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

export function profileConditionJson(knownScope: string | null, contextJson?: string | null): string {
  if (contextJson) {
    try {
      const context = JSON.parse(contextJson) as Record<string, unknown>;
      if (context.schemaVersion === "2") return canonicalJson(contextJson);
    } catch {
      // A malformed historical value falls through to the stable legacy scope.
    }
  }
  const scope = knownScope?.normalize("NFKC").trim() ?? "";
  if (!scope || scope === "キャラクター全体") return "{}";
  return canonicalJson(JSON.stringify({ schemaVersion: "1", scope }));
}
