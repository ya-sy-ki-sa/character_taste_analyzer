import type {
  DarkBaselineUnderstanding,
  DarkScopeAssessment,
  DarkUnderstandingCandidate,
} from "../../../shared/contracts/dark-understanding";
import type { AnyEntryDraft, DarkEntryDraft, EntryDraft } from "../../../shared/contracts/entries";
import type {
  AnyPreferenceCandidate,
  DarkPreferenceCandidate,
  PreferenceCandidate,
} from "../../../shared/contracts/preference";
import type { UnderstandingCandidate } from "../../../shared/contracts/understanding";
import {
  entryBaseCharacterName,
  entryPreferenceContext,
  entryReferenceMaterial,
  entryScopeText,
} from "../../../shared/entry-input";
import { inputEvidence, modelKnowledgeEvidence, preferenceContextFor } from "./input";
import type { EntryContext } from "./types";

export function refinedFakePreferences<T extends AnyPreferenceCandidate>(
  entry: EntryContext,
  candidate: T,
  understanding: UnderstandingCandidate,
): T {
  if (!entry.refinement) return candidate;
  if (entry.refinement.context?.selectedHypotheses?.length)
    return { ...candidate, preferenceAssertions: [], valueStanceAssertions: [] };
  const hypothesis = entry.refinement.mode === "hypotheses";
  const answer = entry.refinement.answers[0]?.answer;
  const channel =
    entry.payload.preference.responseChannels[0] ??
    (entry.analysisDomain === "dark" ? "dark_character_liking" : "narrative_interest");
  return {
    ...candidate,
    preferenceAssertions: understanding.assertions.slice(0, 3).map((item) => ({
      attributeStableKey: item.attributeStableKey,
      rawLabel: item.rawLabel,
      polarity: "positive",
      responseChannel: channel,
      strength: 0.5,
      explicitness: "inferred",
      confidence: hypothesis ? 0.25 : 0.5,
      context: preferenceContextFor(entry.payload),
      evidence: answer
        ? inputEvidence(`/preference/clarifications/${entry.refinement?.id}/0`, answer.slice(0, 500), "inferred")
        : [],
    })),
    summary: {
      ...candidate.summary,
      inferredSummary: [
        hypothesis ? "仮説候補です。自分の好みに合うものだけを確認してください。" : "回答を参考にした候補です。",
      ],
    },
  } as T;
}

export const keywordAttributes: Array<[RegExp, string, string]> = [
  [/ヴィラン|悪役/iu, "role.villain", "ヴィラン"],
  [/端役|モブ|背景/iu, "role.minor", "端役"],
  [/一場面|場面限定/iu, "role.scene_limited", "一場面限定"],
  [/非道徳/iu, "morality.immoral", "非道徳"],
  [/善に関心がない|善への無関心/iu, "goodness.indifferent", "善への無関心"],
  [/純粋悪|悪そのもの/iu, "morality.evil", "悪そのものへの志向"],
  [/残酷|苦しめる/iu, "evil.enjoys_cruelty", "残酷さ"],
  [/改心しない|改心拒否|無改心/iu, "change.no_redemption", "改心しない"],
  [/支配| domin/iu, "agency.dominant", "支配的"],
  [/狡猾|策略/iu, "personality.cunning", "狡猾"],
  [/冷淡|冷酷/iu, "personality.cold", "冷淡"],
  [/傲慢/iu, "personality.arrogant", "傲慢"],
  [/執着/iu, "personality.obsessive", "執着的"],
  [/優美|洗練|上品/iu, "aesthetic.elegant", "優美・洗練"],
  [/人外|非人間/iu, "aesthetic.nonhuman", "非人間的造形"],
  [/孤独|孤立/iu, "relationship.isolated", "孤立"],
  [/復讐/iu, "motivation.revenge", "復讐"],
  [/破壊/iu, "motivation.destruction", "破壊欲"],
  [/知性|頭が切れる|聡明/iu, "ability.intelligent", "知性"],
];

export const darkKeywordAttributes: Array<[RegExp, `dark.${string}`, string]> = [
  [/ヴィラン|悪役/iu, "dark.archetype.villain", "ヴィラン"],
  [/ヴィラン.?プロタゴニスト|悪役主人公/iu, "dark.archetype.villain_protagonist", "ヴィラン・プロタゴニスト"],
  [/アンチヒーロー/iu, "dark.archetype.antihero", "アンチヒーロー"],
  [/ダークヒーロー/iu, "dark.archetype.dark_hero", "ダークヒーロー"],
  [/モラリー.?グレー|道徳的に曖昧/iu, "dark.archetype.morally_gray", "モラリー・グレー"],
  [/堕落|闇堕ち|闇化/iu, "dark.archetype.fallen_hero", "堕落した英雄"],
  [/洗脳/iu, "dark.control.brainwashed", "洗脳"],
  [/憑依|乗っ取/iu, "dark.control.possessed", "憑依・乗っ取り"],
  [/操ら|操作され|マインド.?コントロール/iu, "dark.control.manipulated", "心理的操作"],
  [/強制|無理やり/iu, "dark.control.coerced", "強制された悪"],
  [/抵抗|抗って|正気を取り戻/iu, "dark.identity.inner_resistance", "内的抵抗"],
  [/自我.*残|元の.*残|正義.*残/iu, "dark.identity.retained_self", "自我の保持"],
  [/自我.*上書|人格.*上書|別人格/iu, "dark.identity.overwritten_self", "自我の上書き"],
  [/裏切/iu, "dark.harm.betrayal", "裏切り"],
  [/元味方|かつての仲間/iu, "dark.relationship.former_ally_opposition", "元味方との敵対"],
  [/支配/iu, "dark.harm.domination", "他者支配"],
  [/残酷|冷酷な加害/iu, "dark.harm.cruelty", "残酷さ"],
  [/復讐/iu, "dark.motivation.revenge", "復讐心"],
  [/改心しない|贖罪.*拒|無改心/iu, "dark.outcome.redemption_refused", "贖罪を拒む"],
  [/闇.*維持|戻らない|そのままで/iu, "dark.outcome.remains_dark", "闇の維持"],
  [/闇.*デザイン|黒い衣装|目.*変|紋章|オーラ/iu, "dark.expression.corrupted_design", "闇化したデザイン"],
  [/知略|策略|頭が切れる/iu, "dark.competence.strategic_mastery", "悪役的知略"],
  [/圧倒的|強大な力|無双/iu, "dark.competence.overwhelming_power", "圧倒的な力"],
  [/カリスマ/iu, "dark.expression.dangerous_charisma", "危険なカリスマ"],
];

export function darkInputText(payload: DarkEntryDraft): string {
  return [
    payload.darkContext.focusDescription,
    payload.darkContext.beforeState,
    payload.darkContext.transitionTrigger,
    payload.darkContext.controllerOrInfluence,
    payload.darkContext.controlMechanism,
    payload.darkContext.awarenessAndResistance,
    payload.darkContext.relationshipChange,
    payload.darkContext.responsibilityNote,
    payload.darkContext.desiredOutcome,
    payload.registrationType === "original"
      ? payload.characterBasicInfo
      : payload.registrationType === "customized_existing"
        ? payload.customizationDescription
        : undefined,
    payload.referenceMaterial,
    payload.userCharacterView,
  ]
    .filter(Boolean)
    .join("\n");
}

export function fakeDarkScopeAssessment(payload: DarkEntryDraft): DarkScopeAssessment {
  const text = darkInputText(payload);
  const explicitOut = /ダークではない|悪ではない|該当しない/iu.test(text);
  const matches = darkKeywordAttributes.filter(([pattern]) => pattern.test(text));
  return {
    verdict: explicitOut
      ? "out_of_scope"
      : matches.length || payload.darkContext.archetypeHints.length
        ? "in_scope"
        : "borderline",
    qualifyingArchetypes: payload.darkContext.archetypeHints,
    agencyOrigin: /洗脳|憑依|操ら|支配され|強制/iu.test(text)
      ? "externally_imposed"
      : /自ら|自発|望んで|選ん/iu.test(text)
        ? "self_authored"
        : "unclear",
    scope: payload.preferenceContext ? "phase" : "whole_character",
    rationale: explicitOut
      ? "入力にはダーク対象ではないという明示があります。"
      : matches.length
        ? `ダーク専用概念として${matches
            .slice(0, 4)
            .map((item) => item[2])
            .join("、")}が確認できます。`
        : "注目範囲は指定されていますが、ダーク状態の根拠は確認が必要です。",
    limitations: matches.length ? [] : ["決定論的解析では入力内の明示語だけを判定します"],
    evidence: inputEvidence(
      "/darkContext/focusDescription",
      payload.darkContext.focusDescription.slice(0, 500),
      "direct",
    ),
    recommendedQuestions: matches.length ? [] : ["どの悪・支配・堕落・敵対状態に注目していますか？"],
  };
}

export function fakeDarkBaseline(payload: DarkEntryDraft): DarkBaselineUnderstanding {
  const before = payload.darkContext.beforeState ?? "変化前の情報は未入力";
  return {
    identity: `${entryBaseCharacterName(payload)}のダーク化前ベースライン`,
    narrativeRole: /勇者|英雄|ヒーロー/iu.test(before) ? ["ヒーロー側の人物"] : [],
    agency: ["変化前の主体性は根拠範囲でのみ扱う"],
    moralCommitments: /正義|守る|救う/iu.test(before) ? [before.slice(0, 500)] : [],
    protectedPeopleOrValues: [],
    relationships: payload.darkContext.relationshipChange ? [payload.darkContext.relationshipChange] : [],
    abilitiesAndDuties: [],
    selfConcept: [],
    priorVulnerabilities: [],
    uncertainties: before === "変化前の情報は未入力" ? [{ topic: "変化前", reason: "明示入力がない" }] : [],
    evidence: payload.darkContext.beforeState
      ? inputEvidence("/darkContext/beforeState", payload.darkContext.beforeState.slice(0, 500), "direct")
      : [],
  };
}

export function fakeDarkUnderstanding(
  payload: DarkEntryDraft,
  baseline?: DarkBaselineUnderstanding,
): DarkUnderstandingCandidate {
  const text = darkInputText(payload);
  const matches = darkKeywordAttributes.filter(([pattern]) => pattern.test(text)).slice(0, 30);
  const assertions: DarkUnderstandingCandidate["assertions"] = matches.map(([pattern, stableKey, label]) => {
    const quote = text.match(pattern)?.[0] ?? label;
    return {
      attributeStableKey: stableKey,
      rawLabel: label,
      valueText: quote,
      assertionKind: "user_interpretation",
      scopeText: entryScopeText(payload),
      explicitness: "user_explicit",
      confidence: 0.9,
      evidence: inputEvidence(
        "/darkContext/focusDescription",
        payload.darkContext.focusDescription.slice(0, 500),
        "paraphrase",
      ),
    };
  });
  if (!assertions.length)
    assertions.push({
      attributeStableKey: "dark.archetype.morally_gray",
      rawLabel: "境界的なダーク状態",
      valueText: payload.darkContext.focusDescription,
      assertionKind: "user_interpretation",
      scopeText: entryScopeText(payload),
      explicitness: "user_explicit",
      confidence: 0.65,
      evidence: inputEvidence(
        "/darkContext/focusDescription",
        payload.darkContext.focusDescription.slice(0, 500),
        "direct",
      ),
    });
  const externallyControlled = /洗脳|憑依|操ら|支配され|強制/iu.test(text);
  const retained = /抵抗|自我|正気|元の/iu.test(text);
  return {
    sourceAssessment: {
      coverage: text.length > 300 ? "partial" : "minimal",
      limitations: [],
      modelKnowledgeUsed: false,
    },
    summary: {
      identity: `${payload.characterName}（${payload.darkContext.focusDescription}）`,
      narrativeRole: assertions
        .filter(
          (item) => item.attributeStableKey?.includes(".role.") || item.attributeStableKey?.includes(".archetype."),
        )
        .map((item) => item.rawLabel),
      moralityOrientation: assertions
        .filter(
          (item) => item.attributeStableKey?.includes(".morality.") || item.attributeStableKey?.includes(".harm."),
        )
        .map((item) => item.rawLabel),
      goals: assertions
        .filter((item) => item.attributeStableKey?.includes(".motivation."))
        .map((item) => item.rawLabel),
      values: [],
      behavior: assertions.map((item) => item.valueText),
      relationships: assertions
        .filter((item) => item.attributeStableKey?.includes(".relationship."))
        .map((item) => item.rawLabel),
      expression: assertions
        .filter((item) => item.attributeStableKey?.includes(".expression."))
        .map((item) => item.rawLabel),
    },
    assertions,
    customizationDeltas: [],
    uncertainties: [],
    darkState: {
      agencyOrigin: externallyControlled ? "externally_imposed" : "unclear",
      consent: externallyControlled ? "coerced" : "unknown",
      awareness: /気づ|認識|自覚/iu.test(text) ? "aware" : "unknown",
      resistance: /抵抗|抗っ/iu.test(text) ? "active" : "unknown",
      identityContinuity: retained ? "suppressed" : externallyControlled ? "unknown" : "intact",
      responsibility: externallyControlled ? "contested" : "unknown",
      reversibility: /戻|解除|解放/iu.test(text) ? "conditional" : "unknown",
      controllerOrInfluence: payload.darkContext.controllerOrInfluence ?? null,
      mechanism: payload.darkContext.controlMechanism ?? null,
      before: baseline?.identity ?? payload.darkContext.beforeState ?? null,
      onset: payload.darkContext.transitionTrigger ?? null,
      activeState: payload.darkContext.focusDescription,
      recoveryOrAfter: payload.darkContext.desiredOutcome ?? null,
    },
    transformationDeltas: baseline
      ? [
          {
            operation: retained ? "retained" : externallyControlled ? "suppressed" : "ambiguous",
            aspect: retained ? "元の自我・価値" : "変化前との差分",
            beforeValue: payload.darkContext.beforeState ?? baseline.identity,
            afterValue: payload.darkContext.focusDescription,
            cause: payload.darkContext.transitionTrigger ?? null,
            agencyOrigin: externallyControlled ? "externally_imposed" : "unclear",
            controller: payload.darkContext.controllerOrInfluence ?? null,
            awareness: "unknown",
            resistance: /抵抗|抗っ/iu.test(text) ? "active" : "unknown",
            identityContinuity: retained ? "suppressed" : "unknown",
            responsibility: externallyControlled ? "contested" : "unknown",
            reversibility: "unknown",
            phase: "active",
            confidence: 0.75,
            evidence: inputEvidence(
              "/darkContext/focusDescription",
              payload.darkContext.focusDescription.slice(0, 500),
              "direct",
            ),
          },
        ]
      : [],
    auditNotes: ["役割・道徳性・主体性を分離して確認"],
  };
}

export function fakeUnderstanding(payload: AnyEntryDraft, includeCustomization: boolean): UnderstandingCandidate {
  const characterName =
    payload.registrationType === "customized_existing" && !includeCustomization
      ? entryBaseCharacterName(payload)
      : payload.characterName;
  const preferenceContext =
    payload.registrationType === "customized_existing" && !includeCustomization
      ? undefined
      : entryPreferenceContext(payload);
  const characterBasicInfo = payload.registrationType === "original" ? payload.characterBasicInfo : undefined;
  const referenceMaterial = entryReferenceMaterial(payload);
  const userCharacterView =
    payload.registrationType === "customized_existing" && !includeCustomization ? undefined : payload.userCharacterView;
  const customizationDescription =
    includeCustomization && payload.registrationType === "customized_existing"
      ? payload.customizationDescription
      : undefined;
  const scopeText = preferenceContext ?? "キャラクター全体";
  const combined = [characterBasicInfo, referenceMaterial, userCharacterView, customizationDescription]
    .filter(Boolean)
    .join("\n");
  const sourceByPointer = [
    characterBasicInfo ? { pointer: "/characterBasicInfo", text: characterBasicInfo } : null,
    referenceMaterial ? { pointer: "/referenceMaterial", text: referenceMaterial } : null,
    userCharacterView ? { pointer: "/userCharacterView", text: userCharacterView } : null,
    customizationDescription ? { pointer: "/customizationDescription", text: customizationDescription } : null,
  ].filter((item): item is { pointer: string; text: string } => item !== null);
  const primarySource = sourceByPointer[0];
  const assertions: UnderstandingCandidate["assertions"] = keywordAttributes
    .filter(([pattern]) => pattern.test(combined))
    .slice(0, 20)
    .map(([pattern, stableKey, label]) => {
      const matched = sourceByPointer.find((source) => pattern.test(source.text));
      const quote = matched?.text.match(pattern)?.[0] ?? combined.match(pattern)?.[0] ?? label;
      return {
        attributeStableKey: stableKey,
        rawLabel: label,
        valueText: quote,
        assertionKind: "source_interpretation" as const,
        scopeText,
        explicitness: "source_interpreted" as const,
        confidence: 0.76,
        evidence: matched
          ? inputEvidence(matched.pointer, quote, "direct")
          : primarySource
            ? inputEvidence(primarySource.pointer, quote, "paraphrase")
            : modelKnowledgeEvidence(),
      };
    });
  if (!assertions.length)
    assertions.push({
      attributeStableKey: null,
      rawLabel: combined ? "ユーザーが記述した特徴" : "登録されたキャラクター",
      valueText: combined.slice(0, 500) || `${characterName}の基本情報`,
      assertionKind: combined ? "user_interpretation" : "source_interpretation",
      scopeText,
      explicitness: combined ? "user_explicit" : "model_knowledge",
      confidence: combined ? 0.9 : 0.35,
      evidence: primarySource
        ? inputEvidence(primarySource.pointer, primarySource.text.slice(0, 200), "direct")
        : modelKnowledgeEvidence(),
    });
  return {
    sourceAssessment: {
      coverage: (characterBasicInfo?.length ?? 0) + (referenceMaterial?.length ?? 0) >= 300 ? "partial" : "minimal",
      limitations: payload.registrationType === "original" ? [] : ["決定論的テストでは外部の公開情報検索を行わない"],
      modelKnowledgeUsed: false,
    },
    summary: {
      identity: preferenceContext ? `${characterName}（${preferenceContext}）` : characterName,
      narrativeRole: assertions
        .filter((item) => item.attributeStableKey?.startsWith("role."))
        .map((item) => item.rawLabel),
      moralityOrientation: assertions
        .filter((item) => /^(morality|goodness|evil)\./u.test(item.attributeStableKey ?? ""))
        .map((item) => item.rawLabel),
      goals: assertions
        .filter((item) => item.attributeStableKey?.startsWith("motivation."))
        .map((item) => item.rawLabel),
      values: [],
      behavior: assertions.map((item) => item.valueText).slice(0, 10),
      relationships: assertions
        .filter((item) => item.attributeStableKey?.startsWith("relationship."))
        .map((item) => item.rawLabel),
      expression: assertions
        .filter((item) => item.attributeStableKey?.startsWith("aesthetic."))
        .map((item) => item.rawLabel),
    },
    assertions,
    customizationDeltas:
      includeCustomization && payload.registrationType === "customized_existing"
        ? [
            {
              operation: "unspecified",
              targetAttributeStableKey: null,
              beforeValue: null,
              afterValue: payload.customizationDescription,
              scopeText,
              reasonText: "ユーザーが明示した改変・限定範囲",
              explicitness: "user_explicit",
              confidence: 1,
            },
          ]
        : [],
    uncertainties: [{ topic: "資料範囲", reason: "入力資料の外側は判定しない" }],
  };
}

export function fakePreferences(payload: EntryDraft, understanding: UnderstandingCandidate): PreferenceCandidate {
  const liked = payload.preference.likedReasons ?? "";
  const disliked = payload.preference.dislikedReasons ?? "";
  const channels = payload.preference.responseChannels.length
    ? payload.preference.responseChannels
    : ["person_liking" as const];
  const matched = keywordAttributes.filter(([pattern]) => pattern.test(liked)).slice(0, 12);
  const sources = !liked
    ? []
    : matched.length
      ? matched.map(([, stableKey, label]) => ({ stableKey, label }))
      : understanding.assertions.slice(0, 8).map((item) => ({
          stableKey: item.attributeStableKey,
          label: item.rawLabel,
        }));
  const preferenceAssertions: PreferenceCandidate["preferenceAssertions"] = sources
    .flatMap((item, index) =>
      channels.slice(0, 3).map((responseChannel) => ({
        attributeStableKey: item.stableKey,
        rawLabel: item.label,
        polarity: "positive" as const,
        responseChannel,
        strength: liked ? 0.9 : 0.6,
        explicitness: liked ? ("user_explicit" as const) : ("inferred" as const),
        confidence: liked ? 0.92 : 0.55,
        context: preferenceContextFor(payload),
        evidence: liked ? inputEvidence("/preference/likedReasons", liked.slice(0, 500), "direct") : [],
        _ordinal: index,
      })),
    )
    .map(({ _ordinal: _unused, ...item }) => item);
  for (const [, stableKey, label] of keywordAttributes.filter(([pattern]) => pattern.test(disliked)).slice(0, 8)) {
    preferenceAssertions.push({
      attributeStableKey: stableKey,
      rawLabel: label,
      polarity: "negative",
      responseChannel: "person_liking",
      strength: 0.9,
      explicitness: "user_explicit",
      confidence: 0.92,
      context: preferenceContextFor(payload),
      evidence: inputEvidence("/preference/dislikedReasons", disliked.slice(0, 500), "direct"),
    });
  }
  const stanceText = `${payload.preference.valueStanceNote ?? ""}\n${liked}`;
  const valueStanceAssertions: PreferenceCandidate["valueStanceAssertions"] = [];
  const orientations: Array<[RegExp, PreferenceCandidate["valueStanceAssertions"][number]["orientation"]]> = [
    [/悪そのもの|純粋悪/iu, "evil"],
    [/非道徳/iu, "immoral"],
    [/善への無関心|善に関心がない/iu, "indifferent_to_good"],
    [/逸脱|規範/iu, "transgressive"],
  ];
  for (const [pattern, orientation] of orientations)
    if (pattern.test(stanceText))
      valueStanceAssertions.push({
        targetType: "value",
        targetRef: stanceText.match(pattern)?.[0] ?? orientation,
        stance: /支持しない|行為には反対/iu.test(stanceText) ? "reject" : "affirm",
        orientation,
        context: {
          ...preferenceContextFor(payload),
          conditions: ["フィクション上のキャラクター嗜好"],
        },
        explicitness: "user_explicit",
        confidence: 0.95,
        evidence: payload.preference.valueStanceNote
          ? inputEvidence("/preference/valueStanceNote", payload.preference.valueStanceNote.slice(0, 500), "direct")
          : inputEvidence("/preference/likedReasons", liked.slice(0, 500), "direct"),
      });
  return {
    summary: {
      userExplicitSummary: [liked, payload.preference.valueStanceNote].filter((item): item is string => Boolean(item)),
      inferredSummary: liked ? [] : ["確認済みキャラクター属性からの暫定候補"],
      limitations: liked ? [] : ["好きな理由が未入力のため確認が必要"],
    },
    preferenceAssertions,
    valueStanceAssertions,
    uncertainties: liked
      ? []
      : [
          {
            topic: "好きな理由",
            reason: "明示入力がない",
            recommendedQuestion: "どの点が特に好きですか？",
          },
        ],
  };
}

export function fakeDarkPreferences(
  payload: DarkEntryDraft,
  understanding: DarkUnderstandingCandidate,
): DarkPreferenceCandidate {
  const liked = payload.preference.likedReasons ?? "";
  const disliked = payload.preference.dislikedReasons ?? "";
  const channels = payload.preference.responseChannels;
  const positiveMatches = darkKeywordAttributes.filter(([pattern]) => pattern.test(liked)).slice(0, 20);
  const negativeMatches = darkKeywordAttributes.filter(([pattern]) => pattern.test(disliked)).slice(0, 12);
  const sources = positiveMatches.length
    ? positiveMatches.map(([, stableKey, label]) => ({ stableKey, label }))
    : liked
      ? understanding.assertions
          .slice(0, 6)
          .map((item) => ({ stableKey: item.attributeStableKey, label: item.rawLabel }))
      : [];
  const preferenceAssertions: DarkPreferenceCandidate["preferenceAssertions"] = sources.flatMap((item) =>
    channels.slice(0, 4).map((responseChannel) => ({
      attributeStableKey: item.stableKey,
      rawLabel: item.label,
      polarity: "positive" as const,
      responseChannel,
      strength: 0.9,
      explicitness: "user_explicit" as const,
      confidence: 0.92,
      context: preferenceContextFor(payload),
      evidence: inputEvidence("/preference/likedReasons", liked.slice(0, 500), "direct"),
    })),
  );
  for (const [, stableKey, label] of negativeMatches) {
    const responseChannel = channels[0] ?? "dark_character_liking";
    preferenceAssertions.push({
      attributeStableKey: stableKey,
      rawLabel: label,
      polarity: "negative",
      responseChannel,
      strength: 0.9,
      explicitness: "user_explicit",
      confidence: 0.92,
      context: preferenceContextFor(payload),
      evidence: inputEvidence("/preference/dislikedReasons", disliked.slice(0, 500), "direct"),
    });
  }
  return {
    summary: {
      userExplicitSummary: [liked, payload.preference.valueStanceNote].filter((item): item is string => Boolean(item)),
      inferredSummary: [],
      limitations: liked || channels.length ? [] : ["好きな理由・惹かれ方が未入力のため嗜好を特定しない"],
    },
    preferenceAssertions,
    valueStanceAssertions: payload.preference.valueStanceNote
      ? [
          {
            targetType: "value",
            targetRef: payload.preference.valueStanceNote,
            stance: /支持しない|反対/iu.test(payload.preference.valueStanceNote) ? "reject" : "accept",
            orientation: /無道徳|道徳を判断/iu.test(payload.preference.valueStanceNote)
              ? "indifferent_to_good"
              : "mixed",
            context: preferenceContextFor(payload),
            explicitness: "user_explicit",
            confidence: 0.95,
            evidence: inputEvidence(
              "/preference/valueStanceNote",
              payload.preference.valueStanceNote.slice(0, 500),
              "direct",
            ),
          },
        ]
      : [],
    uncertainties:
      liked || channels.length
        ? []
        : [{ topic: "ダーク嗜好", reason: "明示入力がない", recommendedQuestion: "どのダークな要素に惹かれますか？" }],
    auditNotes: ["人物への好意と行為への道徳的支持を分離"],
  };
}
