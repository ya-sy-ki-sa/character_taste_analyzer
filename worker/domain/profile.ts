import type { ProfileCluster, ProfileTrait, TasteProfile } from "../../shared/schemas";
import { TRAIT_CATEGORIES, traitById } from "../../shared/taxonomy";

export const ALGORITHM_VERSION = "profile-v1";

export type ProfileEvidence = {
  id: string;
  entryId: string;
  workKey: string | null;
  traitId: string;
  confidence: number;
  observation: "stated" | "inferred";
  source: "llm" | "manual";
};

export type ProfileSignal = {
  id: string;
  traitId: string;
  polarity: "positive" | "negative";
  strength: number;
};

export type EntryVector = {
  entryId: string;
  traitIds: string[];
  embedding?: number[];
};

type MutableTrait = ProfileTrait & { entryIds: Set<string>; workCounts: Map<string, number> };

function confidenceLabel(
  evidenceCount: number,
  positiveWeight: number,
  negativeWeight: number,
): ProfileTrait["confidence"] {
  const explicit = positiveWeight + negativeWeight;
  if (evidenceCount >= 6 && explicit >= 2) return "strong";
  if (evidenceCount >= 3) return "moderate";
  if (evidenceCount >= 2 || explicit >= 0.8) return "candidate";
  return "hypothesis";
}

function traitLabel(traitId: string): { label: string; category: string } {
  const trait = traitById.get(traitId);
  return trait
    ? { label: trait.label, category: TRAIT_CATEGORIES[trait.category] }
    : { label: traitId, category: "未分類" };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function cosineDistance(a?: number[], b?: number[]): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccardDistance(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]).size;
  if (union === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return 1 - intersection / union;
}

function entryDistance(a: EntryVector, b: EntryVector): number {
  const semantic = cosineDistance(a.embedding, b.embedding);
  const structured = jaccardDistance(a.traitIds, b.traitIds);
  return semantic === null ? structured : semantic * 0.75 + structured * 0.25;
}

function initializeMedoids(entries: EntryVector[], k: number): number[] {
  const medoids = [0];
  while (medoids.length < k) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (let index = 0; index < entries.length; index += 1) {
      if (medoids.includes(index)) continue;
      const nearest = Math.min(...medoids.map((medoid) => entryDistance(entries[index], entries[medoid])));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    }
    medoids.push(bestIndex);
  }
  return medoids;
}

function assignClusters(entries: EntryVector[], medoids: number[]): number[][] {
  const clusters = medoids.map(() => [] as number[]);
  entries.forEach((entry, index) => {
    let winner = 0;
    let winnerDistance = Number.POSITIVE_INFINITY;
    medoids.forEach((medoid, clusterIndex) => {
      const distance = entryDistance(entry, entries[medoid]);
      if (distance < winnerDistance) {
        winner = clusterIndex;
        winnerDistance = distance;
      }
    });
    clusters[winner].push(index);
  });
  return clusters;
}

function optimizeMedoids(entries: EntryVector[], clusters: number[][]): number[] {
  return clusters.map((cluster) => {
    let best = cluster[0];
    let bestCost = Number.POSITIVE_INFINITY;
    for (const candidate of cluster) {
      const cost = cluster.reduce((sum, item) => sum + entryDistance(entries[candidate], entries[item]), 0);
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    return best;
  });
}

function silhouette(entries: EntryVector[], clusters: number[][]): number {
  const assignment = new Map<number, number>();
  clusters.forEach((cluster, clusterIndex) => {
    cluster.forEach((entryIndex) => {
      assignment.set(entryIndex, clusterIndex);
    });
  });
  let total = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const ownIndex = assignment.get(index) ?? 0;
    const own = clusters[ownIndex].filter((candidate) => candidate !== index);
    const a = own.length
      ? own.reduce((sum, candidate) => sum + entryDistance(entries[index], entries[candidate]), 0) / own.length
      : 0;
    const otherAverages = clusters
      .filter((_, clusterIndex) => clusterIndex !== ownIndex)
      .map(
        (cluster) =>
          cluster.reduce((sum, candidate) => sum + entryDistance(entries[index], entries[candidate]), 0) /
          cluster.length,
      );
    const b = Math.min(...otherAverages);
    total += Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
  }
  return total / entries.length;
}

export function buildClusters(entriesInput: EntryVector[]): ProfileCluster[] {
  const entries = [...entriesInput].sort((a, b) => a.entryId.localeCompare(b.entryId));
  if (entries.length < 8) return [];
  const maxK = Math.min(5, Math.floor(entries.length / 3));
  let best: { score: number; clusters: number[][] } | undefined;

  for (let k = 2; k <= maxK; k += 1) {
    let medoids = initializeMedoids(entries, k);
    let clusters = assignClusters(entries, medoids);
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const next = optimizeMedoids(entries, clusters);
      if (next.every((value, index) => value === medoids[index])) break;
      medoids = next;
      clusters = assignClusters(entries, medoids);
    }
    if (clusters.some((cluster) => cluster.length < 3)) continue;
    const score = silhouette(entries, clusters);
    if (!best || score > best.score) best = { score, clusters };
  }

  if (!best || best.score < 0.2) return [];
  return best.clusters.map((cluster, index) => {
    const counts = new Map<string, number>();
    cluster.forEach((entryIndex) => {
      entries[entryIndex].traitIds.forEach((traitId) => {
        counts.set(traitId, (counts.get(traitId) ?? 0) + 1);
      });
    });
    const representativeTraitIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([traitId]) => traitId);
    return {
      id: `cluster-${index + 1}`,
      label: representativeTraitIds.map((traitId) => traitLabel(traitId).label).join("・") || `タイプ${index + 1}`,
      entryIds: cluster.map((entryIndex) => entries[entryIndex].entryId),
      representativeTraitIds,
    };
  });
}

export function buildTasteProfile(input: {
  profileVersion: number;
  entryCount: number;
  evidence: ProfileEvidence[];
  signals: ProfileSignal[];
  entries: EntryVector[];
  generatedAt?: string;
}): TasteProfile {
  const traits = new Map<string, MutableTrait>();
  const getTrait = (traitId: string): MutableTrait => {
    const existing = traits.get(traitId);
    if (existing) return existing;
    const meta = traitLabel(traitId);
    const created: MutableTrait = {
      traitId,
      label: meta.label,
      category: meta.category,
      occurrenceWeight: 0,
      evidenceCount: 0,
      positiveWeight: 0,
      negativeWeight: 0,
      preferenceMean: null,
      confidence: "hypothesis",
      contradictory: false,
      evidenceIds: [],
      entryIds: new Set(),
      workCounts: new Map(),
    };
    traits.set(traitId, created);
    return created;
  };

  const deduplicatedEvidence = new Map<string, ProfileEvidence>();
  input.evidence.forEach((item) => {
    const key = `${item.entryId}:${item.traitId}`;
    const previous = deduplicatedEvidence.get(key);
    if (!previous || item.confidence > previous.confidence || item.source === "manual")
      deduplicatedEvidence.set(key, item);
  });

  [...deduplicatedEvidence.values()]
    .sort((a, b) => a.entryId.localeCompare(b.entryId) || a.id.localeCompare(b.id))
    .forEach((item) => {
      const target = getTrait(item.traitId);
      const workKey = item.workKey || `original:${item.entryId}`;
      const sameWorkIndex = (target.workCounts.get(workKey) ?? 0) + 1;
      target.workCounts.set(workKey, sameWorkIndex);
      const sourceWeight = item.source === "manual" ? 1 : item.observation === "inferred" ? 0.4 : 0.9;
      target.occurrenceWeight += item.confidence * sourceWeight * (1 / Math.sqrt(sameWorkIndex));
      target.entryIds.add(item.entryId);
      target.evidenceIds.push(item.id);
    });

  input.signals.forEach((signal) => {
    const target = getTrait(signal.traitId);
    if (signal.polarity === "positive") target.positiveWeight += signal.strength;
    else target.negativeWeight += signal.strength;
    target.evidenceIds.push(signal.id);
  });

  const materialized = [...traits.values()].map((trait): ProfileTrait => {
    const explicitWeight = trait.positiveWeight + trait.negativeWeight;
    const preferenceMean = explicitWeight > 0 ? (1 + trait.positiveWeight) / (2 + explicitWeight) : null;
    return {
      traitId: trait.traitId,
      label: trait.label,
      category: trait.category,
      occurrenceWeight: round(trait.occurrenceWeight),
      evidenceCount: trait.entryIds.size,
      positiveWeight: round(trait.positiveWeight),
      negativeWeight: round(trait.negativeWeight),
      preferenceMean: preferenceMean === null ? null : round(preferenceMean),
      confidence: confidenceLabel(trait.entryIds.size, trait.positiveWeight, trait.negativeWeight),
      contradictory: trait.positiveWeight >= 0.5 && trait.negativeWeight >= 0.5,
      evidenceIds: [...new Set(trait.evidenceIds)],
    };
  });

  const frequentTraits = [...materialized]
    .filter((trait) => trait.occurrenceWeight > 0)
    .sort((a, b) => b.occurrenceWeight - a.occurrenceWeight || a.traitId.localeCompare(b.traitId))
    .slice(0, 16);
  const explicitLikes = [...materialized]
    .filter((trait) => trait.positiveWeight > trait.negativeWeight)
    .sort((a, b) => b.positiveWeight - a.positiveWeight)
    .slice(0, 12);
  const explicitDislikes = [...materialized]
    .filter((trait) => trait.negativeWeight > trait.positiveWeight)
    .sort((a, b) => b.negativeWeight - a.negativeWeight)
    .slice(0, 12);
  const contradictions = materialized.filter((trait) => trait.contradictory);
  const leading = frequentTraits.slice(0, 3).map((trait) => trait.label);
  const summary =
    input.entryCount === 0
      ? "キャラクターを登録すると、ここに根拠付きの傾向が表示されます。"
      : leading.length
        ? `${leading.join("、")}が、登録したキャラクターに比較的よく現れています。明示的な好みとは分けて解釈してください。`
        : "現在の入力からは、まだ共通する属性を十分に抽出できていません。";

  return {
    version: input.profileVersion,
    provisional: input.entryCount < 3,
    entryCount: input.entryCount,
    summary,
    frequentTraits,
    explicitLikes,
    explicitDislikes,
    contradictions,
    clusters: buildClusters(input.entries),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
