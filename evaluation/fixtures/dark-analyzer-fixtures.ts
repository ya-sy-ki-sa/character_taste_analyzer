import type { DarkTransformationDelta } from "../../shared/contracts/dark-understanding";
import type { DarkResponseChannel } from "../../shared/dark-response-channels";

export type FrozenDarkAnalyzerFixture = Readonly<{
  id: string;
  archetype:
    | "controlled_hero"
    | "fallen_hero"
    | "manipulated_former_ally"
    | "betraying_ally"
    | "villain"
    | "villain_protagonist"
    | "antihero"
    | "dark_hero"
    | "morally_gray";
  focusDescription: string;
  beforeState: string;
  transition: string;
  preferenceReason: string;
  expected: Readonly<{
    scope: "in_scope" | "borderline";
    agencyOrigin: "self_authored" | "externally_imposed" | "mixed" | "unclear";
    deltaOperation: DarkTransformationDelta["operation"];
    ontologyKey: `dark.${string}`;
    responseChannel: DarkResponseChannel;
  }>;
}>;

const archetypes = Object.freeze([
  {
    value: "controlled_hero",
    label: "洗脳された勇者",
    key: "dark.archetype.controlled_hero",
    channel: "controlled_state_fascination",
  },
  {
    value: "fallen_hero",
    label: "堕落した英雄",
    key: "dark.archetype.fallen_hero",
    channel: "corruption_arc_fascination",
  },
  {
    value: "manipulated_former_ally",
    label: "操作された元味方",
    key: "dark.archetype.manipulated_former_ally",
    channel: "former_ally_tragedy",
  },
  {
    value: "betraying_ally",
    label: "裏切った協力者",
    key: "dark.archetype.betraying_ally",
    channel: "betrayal_fascination",
  },
  {
    value: "villain",
    label: "純粋悪のヴィラン",
    key: "dark.archetype.villain",
    channel: "no_redemption_preference",
  },
  {
    value: "villain_protagonist",
    label: "ヴィラン主人公",
    key: "dark.archetype.villain_protagonist",
    channel: "villain_pov_identification",
  },
  {
    value: "antihero",
    label: "アンチヒーロー",
    key: "dark.archetype.antihero",
    channel: "moral_distance_appreciation",
  },
  {
    value: "dark_hero",
    label: "ダークヒーロー",
    key: "dark.archetype.dark_hero",
    channel: "dark_character_liking",
  },
  {
    value: "morally_gray",
    label: "モラリー・グレーの人物",
    key: "dark.archetype.morally_gray",
    channel: "dark_curiosity",
  },
] as const);

const transformations = Object.freeze([
  {
    value: "retained",
    transition: "元の自我と約束を残したまま自発的に悪側へ立つ",
    agencyOrigin: "self_authored",
  },
  {
    value: "amplified",
    transition: "元からの執着が誘惑と力によって増幅される",
    agencyOrigin: "mixed",
  },
  {
    value: "suppressed",
    transition: "支配者の命令で元の判断と慈悲を抑圧される",
    agencyOrigin: "externally_imposed",
  },
  {
    value: "inverted",
    transition: "洗脳により守るという価値が敵を滅ぼす価値へ反転する",
    agencyOrigin: "externally_imposed",
  },
  {
    value: "removed",
    transition: "契約の代償として過去の所属意識を失う",
    agencyOrigin: "mixed",
  },
  {
    value: "introduced",
    transition: "憑依した存在が新しい破壊衝動と支配の徴を付与する",
    agencyOrigin: "externally_imposed",
  },
  {
    value: "ambiguous",
    transition: "本人の選択か外部操作かを作中根拠から確定できない",
    agencyOrigin: "unclear",
  },
] as const);

export const frozenDarkAnalyzerFixtures: readonly FrozenDarkAnalyzerFixture[] = Object.freeze(
  archetypes.flatMap((archetype) =>
    transformations.map((transformation) =>
      Object.freeze({
        id: `${archetype.value}-${transformation.value}`,
        archetype: archetype.value,
        focusDescription: `${archetype.label}として敵対している期間だけを対象にする`,
        beforeState: "変化前は仲間を守る責務と自分の意思で判断する能力を持っていた",
        transition: transformation.transition,
        preferenceReason: `${archetype.label}のダーク状態と変化差分に惹かれる。元の一般的な英雄性自体は集計しない`,
        expected: Object.freeze({
          scope: "in_scope" as const,
          agencyOrigin: transformation.agencyOrigin,
          deltaOperation: transformation.value,
          ontologyKey: archetype.key,
          responseChannel: archetype.channel,
        }),
      }),
    ),
  ),
);

export const frozenOutOfScopeFixtures = Object.freeze(
  [
    "善良な日常の教師",
    "対立も逸脱もない料理人",
    "闇状態を指定していない王道勇者",
    "悪役を倒すだけの治癒役",
    "道徳的葛藤のない案内人",
    "敵対状態ではない幼なじみ",
    "通常衣装だけを評価する主人公",
  ].map((focusDescription, index) => Object.freeze({ id: `out-of-scope-${index + 1}`, focusDescription })),
);
