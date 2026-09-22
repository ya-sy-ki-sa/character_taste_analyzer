import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import type { UnderstandingAspect } from "../../../shared/understanding-aspects";

type Assertion = Pick<
  UnderstandingCandidate["assertions"][number],
  "attributeStableKey" | "rawLabel" | "valueText" | "scopeText"
>;

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
