import type {
  AnyGeneratedCharacterCandidate,
  DarkGeneratedCharacterCandidate,
  GeneratedCharacterCandidate,
  GenerationValidationReport,
} from "../../../shared/contracts/generation";
import type { GenerationBrief } from "../../../shared/contracts/generation-brief";
import { GENERATION_POLICY_CHECKS, validateGenerationCoverage } from "./validation";

export function fakeValidationReport(
  brief: GenerationBrief,
  candidate: AnyGeneratedCharacterCandidate,
): GenerationValidationReport {
  const violations = validateGenerationCoverage(brief, candidate);
  return {
    passed: violations.length === 0,
    checks: [
      ...brief.preferenceSelections.map((selection) => ({
        constraintId: selection.profileSnapshotItemId,
        status: violations.some((item) => item.includes(selection.profileSnapshotItemId))
          ? ("violated" as const)
          : ("satisfied" as const),
        outputPointers:
          candidate.briefCoverage.find((item) => item.profileSnapshotItemId === selection.profileSnapshotItemId)
            ?.outputPointers ?? [],
        explanation: violations.length ? "決定論的検査結果を参照" : "briefと生成物の対応を確認した",
      })),
      ...GENERATION_POLICY_CHECKS.map((constraintId) => ({
        constraintId,
        status: "satisfied" as const,
        outputPointers: ["/identity/oneLineConcept"],
        explanation: "決定論的fixtureの方針確認",
      })),
    ],
    violations,
  };
}

export function traits(labels: string[], fallback: string) {
  return (labels.length ? labels : [fallback]).slice(0, 8).map((label) => ({
    label,
    description: `${label}を行動と選択に一貫して表す。`,
    expressions: [`${label}が判断に現れる`],
  }));
}

export function fakeCharacter(brief: GenerationBrief, ordinal = 1): GeneratedCharacterCandidate {
  const included = brief.preferenceSelections.filter((item) => item.treatment !== "prohibit");
  const labels = included.map((item) => item.label);
  const orientation = brief.valuePolicy.allowedOrientations.find((item) => item !== "mixed") as
    | GeneratedCharacterCandidate["valuesAndMorality"]["orientation"]
    | undefined;
  const visibility = labels.some((label) => /端役|一場面/iu.test(label)) ? "minor" : "supporting";
  const noRedemption =
    brief.valuePolicy.redemption === "prohibited" || labels.some((label) => /改心しない|改心.*拒/iu.test(label));
  return {
    schemaVersion: "1.0",
    briefId: brief.briefId,
    identity: {
      name: ["霧綴のエナ", "燈紡ぎのルオ", "潮路のゼフィ"][ordinal - 1],
      aliases: ["境界の記録者"],
      oneLineConcept: `${labels.slice(0, 3).join("、") || "静かな執着"}を核に、自らの規範で動く人物`,
      origin:
        brief.creativeContext.world ??
        [
          "都市の忘れられた記録区画から現れた。",
          "灯台を巡る移動工房で育った修理職人。",
          "潮流を測る浮島で航路の裁定を任された。",
        ][ordinal - 1],
      ageExpression: "成人",
      pronouns: null,
    },
    appearance: {
      summary: "既存の固有意匠に依存しない、輪郭と余白を強調した装い。",
      traits: traits(
        labels.filter((label) => /美|造形|人外|威圧|優美/iu.test(label)),
        ["非対称な装い", "煤の付いた作業衣", "潮色の織布"][ordinal - 1],
      ),
    },
    personality: {
      summary: "他者の期待より自分で定めた目的を優先し、矛盾を矛盾のまま抱える。",
      traits: traits(
        labels.filter((label) => !/美|造形|役|改心/iu.test(label)),
        "一貫した自己規範",
      ),
    },
    valuesAndMorality: {
      orientation: orientation ?? "self_defined",
      values: traits(
        labels.filter((label) => /悪|非道徳|善|規範|残酷|支配/iu.test(label)),
        "自己定義の規範",
      ),
      moralRelationship: "社会的な善悪を自動的な判断基準にせず、自分の選択の帰結を引き受ける。",
      redemption: noRedemption
        ? "改心や贖罪を目標にせず、最後まで基本姿勢を変えない。"
        : brief.valuePolicy.redemption === "required"
          ? "自ら選んだ贖罪へ進む。"
          : "改心は物語上の必須条件ではない。",
      hiddenGoodness:
        brief.valuePolicy.hiddenGoodness === "required"
          ? "本人も隠している限定的な善意がある。"
          : "実は善人という補正を設けない。",
      consequences: "行為への他者の反応は描くが、道徳的処罰を必須の結末にはしない。",
    },
    motivations: {
      summary: brief.purpose,
      traits: traits(
        labels.filter((label) => /欲|復讐|破壊|執着|支配/iu.test(label)),
        ["失われた記録の独占", "消えた航路標識の再建", "潮汐による自治境界の維持"][ordinal - 1],
      ),
    },
    abilitiesAndLimits: {
      summary: [
        "痕跡を読み替える力を持つが、直接の強制はできない。",
        "光の軌道を編む技術を持つが、自分の居場所が露見する。",
        "海流を聴く感覚に優れるが、陸地では判断が鈍る。",
      ][ordinal - 1],
      traits: traits(
        labels.filter((label) => /知性|力|戦略|主体/iu.test(label)),
        ["痕跡の編集", "灯火の編成", "潮流の読解"][ordinal - 1],
      ),
    },
    relationships: [
      {
        targetRole: "記録を取り戻そうとする人",
        dynamic: "互いの目的だけが交差する対立関係",
        characterBehavior: "相手を救済対象とみなさず交渉する",
        development: "理解しても同意や改心には直結しない",
      },
    ],
    speech: {
      voice: "短く断定的で、価値判断を他者に預けない。",
      habits: ["結論から述べる"],
      exampleLines: ["それが善いかではなく、私が選ぶかを聞いて。"],
    },
    narrativeRole: {
      role: brief.creativeContext.role ?? "境界で進行を変える対立者",
      function: "主人公の規範が唯一ではないことを示す。",
      agency: "自分の目的で登場し、自分の判断で退場する。",
      visibility,
    },
    characterArc: {
      start: "自ら決めた目的を追う。",
      turningPoints: ["他者の規範を理解した上で受け入れない選択をする。"],
      end: noRedemption ? "姿勢を変えず、自ら選んだ結果へ進む。" : "変化するかどうかを本人が選ぶ余地を残す。",
      changeType: noRedemption ? "no_redemption" : "open",
    },
    briefCoverage: brief.preferenceSelections.map((item) => ({
      profileSnapshotItemId: item.profileSnapshotItemId,
      treatment: item.treatment,
      status: "satisfied",
      outputPointers: ["/personality/traits"],
      explanation:
        item.treatment === "prohibit"
          ? `${item.label}を中心要素にしていない。`
          : `${item.label}を人物の選択・表現へ反映した。`,
    })),
    uncertainties: ["入力された抽象嗜好だけから作成した初稿である。"],
  };
}

export function fakeDarkCharacter(brief: GenerationBrief, ordinal = 1): DarkGeneratedCharacterCandidate {
  const base = fakeCharacter(brief, ordinal);
  const labels = brief.preferenceSelections.map((item) => item.label);
  return {
    ...base,
    schemaVersion: "dark-1.0",
    darkCore: {
      archetypes: ["villain"],
      narrativeFunction: brief.creativeContext.role ?? "ダークな選択とその帰結を担う人物",
      agency: {
        agencyOrigin: "self_authored",
        consent: "chosen",
        awareness: "aware",
        resistance: "none",
        identityContinuity: "intact",
        responsibility: "high",
        reversibility: "unknown",
        controllerOrInfluence: null,
        mechanism: null,
        before: "自らの規範を形成する以前の基礎状態",
        onset: "力と目的を得る選択",
        activeState: labels.slice(0, 4).join("、") || "自己選択したダーク状態",
        recoveryOrAfter: null,
      },
    },
    baselineAndTransition: {
      baseline: "自己規範を形成する前の人物像",
      trigger: "目的のために境界を越える選択",
      retained: ["主体的な意思決定"],
      changed: labels.slice(0, 6),
    },
    darkMorality: {
      logic: "社会的善悪ではなく、自ら定めた目的と代価で判断する。",
      transgressions: labels.filter((label) => /悪|支配|残酷|裏切|破壊|越境/u.test(label)).slice(0, 10),
      responsibility: "自ら選んだ行為の責任を本人に帰属させる。",
    },
    darkRelationships: base.relationships.map((item) => ({
      targetRole: item.targetRole,
      dynamic: item.dynamic,
      beforeAndAfter: item.development,
    })),
    darkArc: {
      currentState: "ダークな自己規範を維持している。",
      possibleOutcome: "改心を既定にせず、選択の結果へ進む。",
      redemptionPolicy: "briefで要求されない限り贖罪を追加しない。",
    },
    darkExpression: {
      summary: "脅威と美的表現が結び付いたダークな外形。",
      traits: traits(
        labels.filter((label) => /美|闇|威圧|不穏|異形|徴/u.test(label)),
        "不穏な静けさ",
      ),
    },
  };
}
