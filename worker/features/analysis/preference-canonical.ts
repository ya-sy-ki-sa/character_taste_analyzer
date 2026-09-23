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
  // 「自分の失敗」は人物についての引用でも使われる。人物の姿への評価が
  // 明示され、候補のsubjectもユーザーでない場合は自己背景とみなさない。
  if (
    item.context.subjects.some((subject) => subject && !/^(?:ユーザー|自分|私|僕|俺|わたし)$/u.test(subject)) &&
    /(?:姿|振る舞い|態度|行動)(?:に|が)(?:憧れ|惹かれ|好き|魅力)/u.test(evidence)
  )
    return false;
  return /(?:自分|私|僕|俺|わたし|本人自身)/u.test(evidence);
}

type Comparison = { kind: "preferred_over" | "inclusive_contrast"; preferred: string; compared: string };

function comparisonsIn(text: string, fromEvidence: boolean): Comparison[] {
  const clean = (part: string) =>
    part
      .trim()
      .replace(/(?:が|も)?(?:好き|いい|魅力的)(?:です|だ)?.*$/u, "")
      .trim();
  const comparisons: Comparison[] = [];
  for (const sentence of text.normalize("NFKC").split(/[。！？]/u)) {
    const body = sentence.trim().replace(/^比較条件[:：]\s*/u, "");
    const patterns: [Comparison["kind"], RegExp][] = [
      ["preferred_over", /(?:^|[、，])([^、，]{2,70}?)より(?:も)?[、，]?([^、，]{2,100})/gu],
      ["inclusive_contrast", /(?:^|[、，])([^、，]{2,70}?)だけ(?:じゃ|では|で)?なく[、，]?([^、，]{2,100})/gu],
    ];
    for (const [kind, pattern] of patterns) {
      for (const match of body.matchAll(pattern)) {
        const preferredText = match[2].trim();
        if (
          fromEvidence &&
          (!/(?:好き|いい|魅力的|応援したい|評価(?:する|したい|している)|優先(?:する|したい))/u.test(preferredText) ||
            /(?:好き(?:では|じゃ|で)?ない|好き(?:だ|です)?とは思わない|いい(?:とは|と)?思わない|魅力的(?:では|じゃ)?ない|応援したくない|応援したいわけ(?:では|じゃ)ない|評価しない|優先しない)/u.test(
              preferredText,
            ))
        )
          continue;
        const compared = clean(match[1]);
        const preferred = clean(preferredText);
        if (compared && preferred) comparisons.push({ kind, compared, preferred });
      }
    }
  }
  return comparisons;
}

function comparedKey(value: string): string {
  return normalized(value).replaceAll("人物", "人").replaceAll("いつも", "ずっと");
}

function preferredKey(value: string): string {
  return normalized(value)
    .replaceAll("人物", "人")
    .replace(/を応援する比較$/u, "を応援したい")
    .replace(/(?:(?:も|を)評価(?:する)?|を優先)$/u, "")
    .replace(/(?:も評価対象|という比較|を重視する比較)$/u, "")
    .replace(/(?:ヒーローっぽさ|ところ|こと|面)$/u, "");
}

function sameComparison(left: Comparison, right: Comparison, unambiguous: boolean): boolean {
  if (left.kind !== right.kind || comparedKey(left.compared) !== comparedKey(right.compared)) return false;
  const preferred = preferredKey(left.preferred);
  const other = preferredKey(right.preferred);
  if (preferred === other) return true;
  // The source quote anchors these narrow paraphrases; shared words alone do not establish identity.
  if (/^(?:食事を通じて|食べさせて)助ける$/u.test(preferred) && /^(?:食事を通じて|食べさせて)助ける$/u.test(other))
    return true;
  if (
    /^(?:誰かを)?助けるために(?:力を)?使う$/u.test(preferred) &&
    /^(?:誰かを)?助けるために(?:力を)?使う$/u.test(other)
  )
    return true;
  if (unambiguous) {
    const pair = [preferred, other];
    if (pair.some((value) => value === "食べさせて助ける") && pair.some((value) => value === "食事による援助"))
      return true;
    if (
      pair.some((value) => /そのときに踏ん張る人を応援したい/u.test(value)) &&
      pair.some((value) => /そのような人を応援したい/u.test(value))
    )
      return true;
    if (
      pair.some((value) => /誰かを助けるために力を使う/u.test(value)) &&
      pair.some((value) => /その力を使う目的/u.test(value))
    )
      return true;
  }
  return unambiguous && /^(?:優先して)?応援したい$/u.test(preferred) && /を応援したい$/u.test(other);
}

function projectComparison(comparison: Comparison): string {
  if (comparison.kind === "inclusive_contrast") return `${comparison.compared}だけでなく${comparison.preferred}も評価`;
  if (/を応援したい$/u.test(comparison.preferred)) return `${comparison.compared}より${comparison.preferred}`;
  return `${comparison.compared}より${comparison.preferred}を優先`;
}

export function withConciseComparison(item: Assertion): Assertion {
  // The comparative relationship may already be the preferred target itself.
  if (item.polarity !== "positive" || /(?:より|だけ(?:じゃ|では|で)?なく)/u.test(item.rawLabel)) return item;
  const comparisons = item.evidence
    .filter((reference) => reference.inputPointer?.startsWith("/preference/"))
    .flatMap((reference) => comparisonsIn(reference.quote ?? "", true))
    .filter(
      (comparison, index, all) => !all.slice(0, index).some((earlier) => sameComparison(earlier, comparison, false)),
    );
  if (comparisons.length === 0) return item;
  const conditions = item.context.conditions.flatMap((value) => {
    const existing = comparisonsIn(value, false);
    if (existing.length !== 1) return [value];
    const duplicate = comparisons.some((comparison) => {
      const onAxis = comparisons.filter(
        (candidate) =>
          candidate.kind === comparison.kind && comparedKey(candidate.compared) === comparedKey(comparison.compared),
      );
      return sameComparison(existing[0], comparison, onAxis.length === 1);
    });
    if (!duplicate) return [value];
    // Keep a separate non-comparative condition in the same field. A11's
    // "大切な人のため" clause must survive removal of the repeated comparison.
    const remaining = value
      .split(/[。！？]/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence && comparisonsIn(sentence, false).length === 0)
      .join("。");
    return remaining ? [remaining] : [];
  });
  return {
    ...item,
    context: {
      ...item.context,
      conditions: [
        ...comparisons.map((comparison) => projectComparison(comparison).slice(0, 500)),
        ...conditions,
      ].slice(0, 10),
    },
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
