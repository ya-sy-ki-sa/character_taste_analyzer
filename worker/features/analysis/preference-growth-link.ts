import type { PreferenceCandidate } from "../../../shared/contracts/preference";

const growthPhrase = /((?:自分から|自ら).{0,40}?(?:うまく|上手|成長).{0,40}?(?:ところ|姿))/u;
const supportPhrase = /(?:仲間として|仲間を).{0,30}応援|応援.{0,30}仲間/u;

/** Link adjacent, explicitly quoted growth praise and support for the same character. */
export function linkGrowthToSupport(
  candidate: PreferenceCandidate,
  likedReasons: string | undefined,
  characterName: string,
): void {
  if (!likedReasons || !characterName) return;
  const growthCandidates = candidate.preferenceAssertions.filter(
    (item) =>
      item.polarity === "positive" &&
      item.context.subjects.includes(characterName) &&
      item.evidence.some(
        (reference) =>
          reference.inputPointer === "/preference/likedReasons" &&
          reference.quote &&
          likedReasons.includes(reference.quote) &&
          growthPhrase.test(reference.quote),
      ),
  );
  for (const support of candidate.preferenceAssertions) {
    if (
      support.polarity !== "positive" ||
      support.responseChannel !== "root_for" ||
      !support.context.subjects.includes(characterName)
    )
      continue;
    const supportQuote = support.evidence.find(
      (reference) =>
        reference.inputPointer === "/preference/likedReasons" &&
        reference.quote &&
        likedReasons.includes(reference.quote) &&
        supportPhrase.test(reference.quote),
    )?.quote;
    if (!supportQuote) continue;
    const supportAt = likedReasons.indexOf(supportQuote);
    const match = growthCandidates
      .flatMap((item) =>
        item.evidence.flatMap((reference) => {
          if (reference.inputPointer !== "/preference/likedReasons" || !reference.quote) return [];
          const phrase = reference.quote.match(growthPhrase)?.[1];
          const at = likedReasons.indexOf(reference.quote);
          const between = likedReasons.slice(at + reference.quote.length, supportAt);
          return phrase &&
            at >= 0 &&
            supportAt > at + reference.quote.length &&
            between.length <= 90 &&
            !/[。.!?！？]/u.test(between)
            ? [{ reference, phrase }]
            : [];
        }),
      )
      .at(-1);
    if (!match) continue;
    const alreadyLinked = support.evidence.some(
      (reference) =>
        reference.inputPointer === match.reference.inputPointer && reference.quote === match.reference.quote,
    );
    if (!alreadyLinked && support.evidence.length >= 3) continue;
    const condition = `${match.phrase}を仲間として応援`;
    if (!support.context.conditions.includes(condition) && support.context.conditions.length < 10)
      support.context.conditions.push(condition);
    if (!alreadyLinked) support.evidence.push({ ...match.reference });
  }
}
