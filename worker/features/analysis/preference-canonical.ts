import type { AnyPreferenceCandidate } from "../../../shared/contracts/preference";

type Assertion = AnyPreferenceCandidate["preferenceAssertions"][number];

const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\s、。・「」『』]/gu, "")
    .toLowerCase();

/** A user's difficulty is context for a reaction, not the preferred character trait. */
export function isSelfBackgroundPreference(item: Assertion): boolean {
  if (item.explicitness === "user_confirmed" || item.polarity !== "positive") return false;
  if (!/(?:引け目|劣等感|コンプレックス|自分の失敗|自身の失敗|自己嫌悪)/u.test(item.rawLabel)) return false;
  const evidence = item.evidence.map((reference) => reference.quote ?? "").join(" ");
  const characterTargeted = item.context.subjects.some(
    (subject) =>
      subject &&
      new RegExp(
        `${subject.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:の|が).{0,16}(?:引け目|劣等感|コンプレックス)`,
        "u",
      ).test(evidence),
  );
  if (characterTargeted && /(?:好き|魅力|惹かれ)/u.test(evidence)) return false;
  return /(?:自分|私|僕|俺|わたし|本人自身)/u.test(evidence);
}

type Comparison = { kind: "preferred_over" | "inclusive_contrast"; preferred: string; compared: string };

function comparisonFromQuote(quote: string): Comparison | null {
  const clean = (part: string) =>
    part
      .trim()
      .replace(/(?:が|も)?(?:好き|いい|魅力的)(?:です|だ)?.*$/u, "")
      .trim();
  for (const text of quote.normalize("NFKC").split(/[。！？]/u)) {
    const preferred = text.match(/(?:^|[、，])([^、，]{2,70}?)より(?:も)?[、，]?([^、，]{2,100})/u);
    if (preferred) return { kind: "preferred_over", compared: clean(preferred[1]), preferred: clean(preferred[2]) };
    const inclusive = text.match(/(?:^|[、，])([^、，]{2,70}?)だけ(?:じゃ|では|で)?なく[、，]?([^、，]{2,100})/u);
    if (inclusive) return { kind: "inclusive_contrast", compared: clean(inclusive[1]), preferred: clean(inclusive[2]) };
  }
  return null;
}

export function withConciseComparison(item: Assertion): Assertion {
  // The comparative relationship may already be the preferred target itself.
  if (/(?:より|だけ(?:じゃ|では|で)?なく)/u.test(item.rawLabel)) return item;
  const comparison = item.evidence
    .filter((reference) => reference.inputPointer?.startsWith("/preference/"))
    .map((reference) => comparisonFromQuote(reference.quote ?? ""))
    .find((value): value is Comparison => value !== null);
  if (!comparison) return item;
  const condition =
    comparison.kind === "preferred_over"
      ? `${comparison.compared}より${comparison.preferred}を優先`
      : `${comparison.compared}だけでなく${comparison.preferred}も評価`;
  const conditions = item.context.conditions.filter(
    (value) => !value.startsWith("比較条件：") && !value.includes(comparison.preferred),
  );
  return {
    ...item,
    context: { ...item.context, conditions: [...conditions, condition.slice(0, 500)].slice(0, 10) },
  };
}

/** Only exact semantic peers can share a saved preference; response paths stay separate. */
export function uniquePreferenceIndexes(items: Assertion[]): number[] {
  const seen = new Set<string>();
  return items.flatMap((item, index) => {
    const key = JSON.stringify({
      target: normalized(item.attributeStableKey ?? item.rawLabel),
      polarity: item.polarity,
      responseChannel: item.responseChannel,
      context: {
        conditions: item.context.conditions.map(normalized).sort(),
        exceptions: item.context.exceptions.map(normalized).sort(),
        subjects: item.context.subjects.map(normalized).sort(),
      },
      evidence: item.evidence
        .map((reference) => `${reference.inputPointer}:${normalized(reference.quote ?? "")}`)
        .sort(),
    });
    if (seen.has(key)) return [];
    seen.add(key);
    return [index];
  });
}
