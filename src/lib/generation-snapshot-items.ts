import type { GenerationSnapshotItem } from "../../shared/contracts/generation-response";

export type GenerationSnapshotItemGroup = GenerationSnapshotItem & {
  itemIds: string[];
  responseChannels: string[];
  conditions: Record<string, unknown>[];
};

export type SnapshotTreatment = "include" | "prohibit" | "omit";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function canonicalRecord(value: Record<string, unknown>): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)]),
      );
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export function groupGenerationSnapshotItems(items: GenerationSnapshotItem[]): GenerationSnapshotItemGroup[] {
  const groups = new Map<string, GenerationSnapshotItemGroup>();
  for (const item of items) {
    const key = `${item.type}\u0000${item.stableKey}`;
    const responseChannel = typeof item.payload.responseChannel === "string" ? item.payload.responseChannel : null;
    const condition = asRecord(item.payload.condition);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...item,
        itemIds: [item.id],
        responseChannels: responseChannel ? [responseChannel] : [],
        conditions: condition ? [condition] : [],
      });
      continue;
    }
    current.itemIds.push(item.id);
    if (responseChannel && !current.responseChannels.includes(responseChannel)) {
      current.responseChannels.push(responseChannel);
    }
    if (condition && !current.conditions.some((value) => canonicalRecord(value) === canonicalRecord(condition))) {
      current.conditions.push(condition);
    }
  }
  return [...groups.values()];
}

export function expandSnapshotTreatments(
  groups: GenerationSnapshotItemGroup[],
  treatments: Record<string, SnapshotTreatment>,
  overrides: Record<string, SnapshotTreatment> = {},
): { selectedItemIds: string[]; prohibitedItemIds: string[] } {
  const selectedItemIds: string[] = [];
  const prohibitedItemIds: string[] = [];
  for (const group of groups) {
    const treatment = treatments[group.id] ?? "omit";
    for (const id of group.itemIds) {
      const selected = overrides[id] ?? treatment;
      if (selected === "include") selectedItemIds.push(id);
      if (selected === "prohibit") prohibitedItemIds.push(id);
    }
  }
  return { selectedItemIds, prohibitedItemIds };
}

export function snapshotConditionLabel(value: unknown): string {
  const condition = asRecord(value) ?? {};
  const fields = [
    ["entryScope", "対象"],
    ["scope", "対象"],
    ["freeText", "対象"],
    ["subjects", "人物"],
    ["relationships", "関係"],
    ["narrativePhases", "時期"],
    ["conditions", "条件"],
    ["exceptions", "例外"],
  ] as const;
  return fields
    .flatMap(([key, label]) => {
      const raw = condition[key];
      const text =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw.filter((item) => typeof item === "string").join("、")
            : "";
      return text.trim() ? [`${label}：${text}`] : [];
    })
    .join(" ／ ");
}
