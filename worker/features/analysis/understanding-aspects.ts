import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import { understandingAspectLabels, type UnderstandingAspect } from "../../../shared/understanding-aspects";

type Assertion = Pick<
  UnderstandingCandidate["assertions"][number],
  "attributeStableKey" | "rawLabel" | "valueText" | "scopeText"
> & { explicitness?: UnderstandingCandidate["assertions"][number]["explicitness"] };

const stableKeyRules: ReadonlyArray<readonly [RegExp, UnderstandingAspect]> = [
  [/(?:^|\.)(?:role|archetype)\./u, "narrativeRole"],
  [/(?:^|\.)(?:morality|goodness|evil|harm|redemption)\./u, "moralityOrientation"],
  [/(?:^|\.)motivation\./u, "goals"],
  [/(?:^|\.)relationship\./u, "relationships"],
  [/(?:^|\.)(?:aesthetic|speech|tone|expression)\./u, "expression"],
  [
    /(?:^|\.)(?:personality|warmth|trust|agency|ability|competence|vulnerability|duality|change|outcome|control|corruption|identity)\./u,
    "behavior",
  ],
];

const textRules: ReadonlyArray<readonly [UnderstandingAspect, RegExp]> = [
  ["narrativeRole", /(?:主人公|ヒーロー|ヴィラン|悪役|敵役|敵対者|脇役|端役|物語上の役割)/u],
  ["moralityOrientation", /(?:道徳|善悪|正義|非道徳|残酷|加害|悪そのもの|改心|贖罪)/u],
  ["goals", /(?:目的|目標|目指|野心|復讐|欲求|望んで|望む|ために)/u],
  ["values", /(?:価値|信念|大切|重視|優先|責任|規範|譲れ|守るべき)/u],
  ["behavior", /(?:行動|振る舞|態度|助け|守る|戦う|接する|取り組|対応|諦め|実行)/u],
  ["relationships", /(?:関係|仲間|友人|友達|家族|弟|兄|姉|妹|親|子ども|相手|恋人|師匠|部下|上司|ライバル)/u],
  ["expression", /(?:外見|容姿|衣装|服装|髪|瞳|声|話し方|口調|表情|笑顔|デザイン|造形|演出|雰囲気)/u],
];

export function stableKeyUnderstandingAspect(stableKey: string | null): UnderstandingAspect | null {
  if (!stableKey) return null;
  return stableKeyRules.find(([pattern]) => pattern.test(stableKey))?.[1] ?? null;
}

/** Stable ontology meaning is primary; narrow textual signals may add grounded secondary aspects. */
export function understandingAssertionAspects(assertion: Assertion): UnderstandingAspect[] {
  const primary = stableKeyUnderstandingAspect(assertion.attributeStableKey);
  // A model-only claim with an explicit aspect label must not fill unrelated
  // categories merely because its sentence mentions an actor or a relationship.
  // Those extra cards otherwise look complete without distinct information.
  if (assertion.explicitness === "model_knowledge") {
    const labelled = (Object.entries(understandingAspectLabels) as [UnderstandingAspect, string][]).find(
      ([, label]) => assertion.rawLabel.trim() === label,
    )?.[0];
    if (labelled) return [labelled];
    if (primary) return [primary];
    const label = assertion.rawLabel.trim();
    const specificLabels: ReadonlyArray<readonly [RegExp, UnderstandingAspect]> = [
      [/(?:関係|師弟|幼なじみ|兄弟|友人)/u, "relationships"],
      [/(?:表現|話し方|口調|声|表情|感情の表れ)/u, "expression"],
      [/(?:価値|信念|大切|重んじ|理想像|ヒーロー像)/u, "values"],
      [/(?:目的|目標|夢|野心)/u, "goals"],
      [/(?:観察|分析|振る舞い|行動|対処|戦い方)/u, "behavior"],
      [/(?:道徳|正義|善悪|英雄的)/u, "moralityOrientation"],
      [/(?:役割|主人公|ヒーロー|敵役)/u, "narrativeRole"],
    ];
    const fromLabel = specificLabels.find(([pattern]) => pattern.test(label))?.[1];
    if (fromLabel) return [fromLabel];
  }
  const text = `${assertion.rawLabel} ${assertion.valueText} ${assertion.scopeText}`;
  return [
    ...new Set([
      ...(primary ? [primary] : []),
      ...textRules.flatMap(([aspect, pattern]) => (pattern.test(text) ? [aspect] : [])),
    ]),
  ];
}

const registrationMetadata =
  /(?:作品|媒体|対象キャラクター|キャラクター名|人物同定|登場人物としての同定|分析対象|物語範囲|対象指定)/u;
const attributionOnly =
  /(?:ユーザー(?:自身)?の解釈|読み方).*(?:公式|主張されていない)|(?:公式|主張されていない).*(?:ユーザー(?:自身)?の解釈|読み方)/u;
const roleLabelOnly = /^(?:『[^』]+』の)?(?:主人公|ヒーロー|ヴィラン|悪役|敵役|敵対者|脇役|端役)(?:である)?[。.]?$/u;

/** Excludes registration labels and attribution notes before they affect information-quality counts. */
export function isConcreteUnderstandingAssertion(assertion: Assertion): boolean {
  const value = assertion.valueText.trim();
  if (
    !value ||
    registrationMetadata.test(assertion.rawLabel) ||
    attributionOnly.test(value) ||
    roleLabelOnly.test(value)
  )
    return false;
  if (assertion.attributeStableKey && value !== assertion.rawLabel.trim()) return true;
  return value.length >= 12;
}
