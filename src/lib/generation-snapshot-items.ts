export type GenerationSnapshotItem = {
  id: string;
  type: string;
  stableKey: string;
  label: string;
  payload: Record<string, unknown>;
};

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
): { selectedItemIds: string[]; prohibitedItemIds: string[] } {
  const selectedItemIds: string[] = [];
  const prohibitedItemIds: string[] = [];
  for (const group of groups) {
    const treatment = treatments[group.id] ?? "omit";
    if (treatment === "include") selectedItemIds.push(...group.itemIds);
    if (treatment === "prohibit") prohibitedItemIds.push(...group.itemIds);
  }
  return { selectedItemIds, prohibitedItemIds };
}
