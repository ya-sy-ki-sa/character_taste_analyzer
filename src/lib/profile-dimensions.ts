import type { ProfileDimension } from "../../shared/contracts/profile-response";

export type DisplayProfileDimension = ProfileDimension & {
  responseChannels: Array<NonNullable<ProfileDimension["responseChannel"]>>;
  conditions: Record<string, unknown>[];
};

function canonicalCondition(value: Record<string, unknown>): string {
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

export function groupProfileDimensions(dimensions: ProfileDimension[]): DisplayProfileDimension[] {
  const groups = new Map<string, DisplayProfileDimension>();
  const classificationRank = { insufficient: 0, emerging: 1, stable: 2 } as const;
  for (const item of dimensions) {
    const key = item.stableKey;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...item,
        responseChannels: item.responseChannel ? [item.responseChannel] : [],
        conditions: [item.condition],
      });
      continue;
    }
    if (item.responseChannel && !current.responseChannels.includes(item.responseChannel)) {
      current.responseChannels.push(item.responseChannel);
    }
    if (!current.conditions.some((condition) => canonicalCondition(condition) === canonicalCondition(item.condition))) {
      current.conditions.push(item.condition);
    }
    current.positiveScore = Math.max(current.positiveScore, item.positiveScore);
    current.negativeScore = Math.max(current.negativeScore, item.negativeScore);
    current.confidence = Math.max(current.confidence, item.confidence);
    current.evidenceCount += item.evidenceCount;
    current.identityCount = Math.max(current.identityCount, item.identityCount);
    current.workCount = Math.max(current.workCount, item.workCount);
    current.flags = [...new Set([...current.flags, ...item.flags])];
    if (classificationRank[item.classification] > classificationRank[current.classification]) {
      current.classification = item.classification;
    }
  }
  return [...groups.values()];
}
