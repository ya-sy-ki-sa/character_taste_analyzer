import type { AnyPreferenceCandidate, PreferenceCandidate } from "../../../shared/contracts/preference";

/** A high evaluation in the user's liked-reasons can also express a value judgment. */
export function isExplicitHeroPraise(
  assertion: AnyPreferenceCandidate["preferenceAssertions"][number],
  likedReasons: string | undefined,
): boolean {
  return (
    assertion.polarity === "positive" &&
    assertion.responseChannel === "admiration" &&
    Boolean(
      assertion.evidence.some(
        (reference) =>
          reference.inputPointer === "/preference/likedReasons" &&
          reference.quote &&
          /本当のヒーローだと思う/u.test(reference.quote) &&
          !/(?:ではない|じゃない|とは思わない|わけではない)/u.test(reference.quote) &&
          likedReasons?.includes(reference.quote),
      ),
    )
  );
}

/** Retain an independently quoted high evaluation even if generation kept only cheering. */
export function retainExplicitAdmiration(candidate: PreferenceCandidate, likedReasons: string | undefined): void {
  if (!likedReasons) return;
  const admirationSentence = [...likedReasons.matchAll(/[^。！？.!?]+[。！？.!?]?/gu)]
    .map(([sentence]) => sentence.trim())
    .find((sentence) => /本当のヒーローだと思う/u.test(sentence));
  if (!admirationSentence) return;
  const target = admirationSentence.match(/([^。！？.!?]{4,150}?)のが本当のヒーローだと思う/u)?.[1]?.trim();
  if (!target || /(?:ではない|じゃない|とは思わない)/u.test(admirationSentence)) return;
  const source = candidate.preferenceAssertions.find(
    (item) =>
      item.polarity === "positive" &&
      item.responseChannel === "root_for" &&
      item.evidence.some(
        (reference) =>
          reference.inputPointer === "/preference/likedReasons" &&
          reference.quote &&
          admirationSentence.includes(reference.quote) &&
          reference.quote.length >= 8,
      ),
  );
  if (
    !source ||
    candidate.preferenceAssertions.some(
      (item) =>
        item.responseChannel === "admiration" &&
        item.evidence.some(
          (reference) => reference.quote && admirationSentence.includes(reference.quote) && reference.quote.length >= 8,
        ),
    )
  )
    return;
  candidate.preferenceAssertions.push({
    ...source,
    attributeStableKey: null,
    rawLabel: target.slice(0, 200),
    responseChannel: "admiration",
    context: { ...source.context, conditions: [] },
    evidence: [
      {
        sourceRef: "input:/preference/likedReasons",
        sourceUrl: null,
        inputPointer: "/preference/likedReasons",
        quote: admirationSentence,
        inferenceType: "direct",
      },
    ],
  });
}
