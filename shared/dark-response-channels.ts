export const darkResponseChannelCatalog = [
  {
    value: "dark_character_liking",
    label: "ダークな人物像として好き",
    description: "闇の状態を含む人物像そのものへの好意",
  },
  {
    value: "villain_role_fascination",
    label: "悪役・敵役として魅力的",
    description: "物語を動かす悪役や敵対者としての魅力",
  },
  {
    value: "menacing_aesthetic_liking",
    label: "脅威を伴う外見・雰囲気が好き",
    description: "不穏さ、闇化デザイン、威圧感への美的反応",
  },
  {
    value: "dark_performance_liking",
    label: "悪役的な声・演技・演出が好き",
    description: "口調、演技、音楽、登場演出への反応",
  },
  {
    value: "dark_competence_admiration",
    label: "悪役的な有能さに惹かれる",
    description: "知略、力、冷酷な効率、支配力への評価",
  },
  {
    value: "power_fantasy",
    label: "力や支配を代理体験したい",
    description: "現実と切り分けて圧倒的な力や支配を味わう",
  },
  { value: "transgression_fascination", label: "逸脱・禁忌に惹かれる", description: "規範を越える姿そのものへの魅了" },
  {
    value: "moral_distance_appreciation",
    label: "支持せず距離を保って鑑賞する",
    description: "行為への支持とキャラクターの魅力を分離する",
  },
  { value: "dark_love_to_hate", label: "嫌悪を含めて楽しい", description: "嫌いであることと魅力が両立する" },
  { value: "root_for_dark_side", label: "悪側の勝利を見たい", description: "道徳的支持とは別に成功や勝利を望む" },
  {
    value: "villain_pov_identification",
    label: "ヴィラン視点で体験したい",
    description: "闇側の視点や目標を一時的に採用する",
  },
  {
    value: "vicarious_transgression",
    label: "禁じられた行動を代理体験したい",
    description: "フィクションとして反抗や加害を代理経験する",
  },
  {
    value: "dominance_fascination",
    label: "支配する側に惹かれる",
    description: "他者を制御し主導権を握る状態への反応",
  },
  {
    value: "controlled_state_fascination",
    label: "支配・洗脳された状態に惹かれる",
    description: "主体性を奪われた変化や振る舞いへの反応",
  },
  {
    value: "corruption_arc_fascination",
    label: "堕落・闇化の過程に惹かれる",
    description: "変化前から闇状態へ至る過程への反応",
  },
  {
    value: "betrayal_fascination",
    label: "裏切り・敵対化に惹かれる",
    description: "協力者や味方が敵へ転じる構造への反応",
  },
  {
    value: "former_ally_tragedy",
    label: "元味方との悲劇に惹かれる",
    description: "過去の関係が残る敵対や対決への反応",
  },
  {
    value: "identity_erosion_fascination",
    label: "自我の侵食・上書きに惹かれる",
    description: "同一性が失われ、変質する状態への反応",
  },
  {
    value: "inner_resistance_fascination",
    label: "残る自我・内的抵抗に惹かれる",
    description: "支配下でなお残る意思や正義への反応",
  },
  {
    value: "surrender_fascination",
    label: "闇や支配を受け入れる瞬間に惹かれる",
    description: "抵抗をやめ、闇側へ同化する転換への反応",
  },
  {
    value: "toxic_bond_fascination",
    label: "歪んだ関係性に惹かれる",
    description: "支配、依存、執着、毒性的献身への反応",
  },
  {
    value: "selective_tenderness_contrast",
    label: "闇の中の選択的な情に惹かれる",
    description: "全面的な善化ではない限定的な保護や情との対比",
  },
  { value: "fear_thrill", label: "恐怖・緊張を楽しむ", description: "脅威や予測不能さによる安全なスリル" },
  { value: "dark_curiosity", label: "内面や行く末を観察したい", description: "好意や支持とは別の好奇心" },
  {
    value: "rescue_restore_desire",
    label: "救出・元の自己への回復を望む",
    description: "支配からの解放や元の状態への回復願望",
  },
  {
    value: "preserve_dark_state",
    label: "闇の状態を保ってほしい",
    description: "元へ戻さず現在のダーク状態を維持してほしい",
  },
  { value: "no_redemption_preference", label: "改心せずにいてほしい", description: "贖罪や善性の追加を望まない" },
  { value: "dark_outcome_interest", label: "勝敗・処罰・結末が気になる", description: "闇の人物が迎える結果への関心" },
  {
    value: "safe_taboo_exploration",
    label: "安全に禁忌を探索したい",
    description: "現実と切り分けた価値・衝動・境界の探索",
  },
  { value: "dark_romantic_attraction", label: "恋愛的に惹かれる", description: "ダークな人物像への恋愛的魅力" },
  { value: "dark_sexual_attraction", label: "性的に惹かれる", description: "ダークな人物像への性的魅力" },
  {
    value: "dark_creative_inspiration",
    label: "創作したくなる",
    description: "ダークな人物像から二次創作や考察の意欲を得る",
  },
] as const;

export type DarkResponseChannel = (typeof darkResponseChannelCatalog)[number]["value"];

export const darkResponseChannelValues = darkResponseChannelCatalog.map((item) => item.value) as [
  DarkResponseChannel,
  ...DarkResponseChannel[],
];

const byValue = new Map<string, (typeof darkResponseChannelCatalog)[number]>(
  darkResponseChannelCatalog.map((item) => [item.value, item]),
);

export function darkResponseChannelLabel(value: string): string {
  return byValue.get(value)?.label ?? "その他のダークな惹かれ方";
}

export function darkResponseChannelPrompt(): string {
  return darkResponseChannelCatalog.map((item) => `${item.value}: ${item.label} — ${item.description}`).join("\n");
}
