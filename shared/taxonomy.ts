export const TAXONOMY_VERSION = "2026-08-v1";

export const TRAIT_CATEGORIES = {
  appearance: "外見・表現",
  temperament: "性格・気質",
  relationship: "関係性",
  values: "価値観・動機",
  competence: "能力・有能さ",
  narrative: "物語上の役割",
  conflict: "背景・葛藤",
  aesthetic: "雰囲気・美学",
  compound: "複合的魅力",
} as const;

export type TraitCategory = keyof typeof TRAIT_CATEGORIES;

export const TRAITS = [
  ["appearance.elegant", "上品・優雅", "appearance"],
  ["appearance.cute", "可愛らしい", "appearance"],
  ["appearance.intimidating", "威圧感", "appearance"],
  ["appearance.nonhuman", "人外的特徴", "appearance"],
  ["appearance.distinctive", "印象的な装い", "appearance"],
  ["temperament.warm", "温かい", "temperament"],
  ["temperament.reserved", "寡黙・内向的", "temperament"],
  ["temperament.expressive", "感情表現が豊か", "temperament"],
  ["temperament.playful", "遊び心がある", "temperament"],
  ["temperament.diligent", "真面目・几帳面", "temperament"],
  ["temperament.impulsive", "衝動的", "temperament"],
  ["temperament.idealistic", "理想主義", "temperament"],
  ["temperament.cunning", "狡猾・策略家", "temperament"],
  ["temperament.vulnerable", "脆さを抱える", "temperament"],
  ["temperament.stoic", "冷静・ストイック", "temperament"],
  ["temperament.confident", "自信家", "temperament"],
  ["relationship.protective", "守ろうとする", "relationship"],
  ["relationship.devoted", "献身的", "relationship"],
  ["relationship.rivalry", "ライバル関係", "relationship"],
  ["relationship.mentor", "師弟関係", "relationship"],
  ["relationship.gradual_trust", "徐々に信頼する", "relationship"],
  ["relationship.teasing", "からかい合う", "relationship"],
  ["values.justice", "正義", "values"],
  ["values.freedom", "自由", "values"],
  ["values.duty", "義務・責任", "values"],
  ["values.belonging", "居場所・帰属", "values"],
  ["values.knowledge", "知識への探究", "values"],
  ["values.ambition", "野心", "values"],
  ["values.revenge", "復讐", "values"],
  ["competence.intelligence", "知略", "competence"],
  ["competence.combat", "戦闘能力", "competence"],
  ["competence.magic", "魔法・異能", "competence"],
  ["competence.technology", "技術力", "competence"],
  ["competence.leadership", "統率力", "competence"],
  ["competence.artistry", "芸術性", "competence"],
  ["competence.growth", "成長型", "competence"],
  ["narrative.protagonist", "主人公性", "narrative"],
  ["narrative.antagonist", "敵役", "narrative"],
  ["narrative.antihero", "反英雄", "narrative"],
  ["narrative.strategist", "参謀役", "narrative"],
  ["narrative.redemption", "贖罪", "narrative"],
  ["narrative.fall", "堕落", "narrative"],
  ["narrative.underdog", "弱者からの成長", "narrative"],
  ["conflict.loss", "喪失", "conflict"],
  ["conflict.secret", "秘密", "conflict"],
  ["conflict.isolation", "孤立", "conflict"],
  ["conflict.identity", "自己同一性の葛藤", "conflict"],
  ["conflict.sacrifice", "犠牲", "conflict"],
  ["conflict.recovery", "回復・再生", "conflict"],
  ["aesthetic.gothic", "ゴシック", "aesthetic"],
  ["aesthetic.graceful", "優美", "aesthetic"],
  ["aesthetic.dark", "ダーク", "aesthetic"],
  ["aesthetic.bright", "明るい", "aesthetic"],
  ["aesthetic.scifi", "SF", "aesthetic"],
  ["aesthetic.fantasy", "幻想的", "aesthetic"],
  ["compound.gap", "意外なギャップ", "compound"],
  ["compound.tender_strength", "強さと優しさの同居", "compound"],
  ["compound.cold_kind", "冷淡さの奥の優しさ", "compound"],
] as const satisfies ReadonlyArray<readonly [string, string, TraitCategory]>;

export type TraitId = (typeof TRAITS)[number][0];

export type TraitDefinition = {
  id: TraitId;
  label: string;
  category: TraitCategory;
};

export const traitById: ReadonlyMap<string, TraitDefinition> = new Map(
  TRAITS.map(([id, label, category]) => [id, { id, label, category }] as const),
);

export const traitPromptCatalog = TRAITS.map(
  ([id, label, category]) => `${id}: ${label}（${TRAIT_CATEGORIES[category]}）`,
).join("\n");
