import type { CharacterEntryInput, GeneratedCharacter, TraitExtraction } from "../../shared/schemas";
import { type TraitId, traitById } from "../../shared/taxonomy";

const KEYWORDS: ReadonlyArray<readonly [TraitId, readonly string[]]> = [
  ["appearance.elegant", ["上品", "優雅", "気品"]],
  ["appearance.cute", ["可愛い", "かわいい", "愛らしい"]],
  ["appearance.intimidating", ["威圧", "怖い見た目", "迫力"]],
  ["appearance.nonhuman", ["人外", "獣人", "機械生命", "精霊", "妖怪"]],
  ["temperament.warm", ["優しい", "温かい", "思いやり"]],
  ["temperament.reserved", ["寡黙", "無口", "内向的"]],
  ["temperament.expressive", ["感情豊か", "表情豊か", "感情表現"]],
  ["temperament.playful", ["遊び心", "お茶目", "いたずら"]],
  ["temperament.diligent", ["真面目", "几帳面", "努力家"]],
  ["temperament.impulsive", ["衝動的", "直情的", "考えるより先"]],
  ["temperament.idealistic", ["理想主義", "理想を追", "信念"]],
  ["temperament.cunning", ["狡猾", "策略", "策士"]],
  ["temperament.vulnerable", ["脆さ", "弱さ", "傷つきやす"]],
  ["temperament.stoic", ["冷静", "ストイック", "冷淡"]],
  ["temperament.confident", ["自信家", "自信に満ち", "堂々"]],
  ["relationship.protective", ["守る", "庇う", "保護"]],
  ["relationship.devoted", ["献身", "尽くす", "一途"]],
  ["relationship.rivalry", ["ライバル", "競い合"]],
  ["relationship.mentor", ["師弟", "師匠", "弟子"]],
  ["relationship.gradual_trust", ["徐々に信頼", "少しずつ心", "打ち解け"]],
  ["relationship.teasing", ["からか", "軽口", "冗談を言い合"]],
  ["values.justice", ["正義", "弱きを助け"]],
  ["values.freedom", ["自由", "束縛を嫌"]],
  ["values.duty", ["義務", "責任感", "使命"]],
  ["values.belonging", ["居場所", "帰属", "仲間を求"]],
  ["values.knowledge", ["知識", "探究", "研究"]],
  ["values.ambition", ["野心", "頂点", "成り上が"]],
  ["values.revenge", ["復讐", "仇"]],
  ["competence.intelligence", ["知略", "頭脳", "天才", "賢い"]],
  ["competence.combat", ["戦闘", "剣士", "格闘"]],
  ["competence.magic", ["魔法", "異能", "超能力"]],
  ["competence.technology", ["技術", "エンジニア", "発明"]],
  ["competence.leadership", ["統率", "リーダー", "指揮"]],
  ["competence.artistry", ["芸術", "音楽", "絵画", "創作"]],
  ["competence.growth", ["成長", "未熟", "努力して強"]],
  ["narrative.antagonist", ["敵役", "悪役", "宿敵"]],
  ["narrative.antihero", ["反英雄", "アンチヒーロー"]],
  ["narrative.strategist", ["参謀", "軍師", "作戦を立"]],
  ["narrative.redemption", ["贖罪", "罪を償"]],
  ["narrative.fall", ["堕落", "闇落ち"]],
  ["narrative.underdog", ["弱者から", "這い上が", "落ちこぼれ"]],
  ["conflict.loss", ["喪失", "失った", "死別"]],
  ["conflict.secret", ["秘密", "正体を隠"]],
  ["conflict.isolation", ["孤立", "孤独", "ひとりぼっち"]],
  ["conflict.identity", ["自分が何者", "自己同一", "アイデンティティ"]],
  ["conflict.sacrifice", ["犠牲", "身を捧"]],
  ["conflict.recovery", ["回復", "再生", "立ち直"]],
  ["aesthetic.gothic", ["ゴシック"]],
  ["aesthetic.graceful", ["優美", "優雅"]],
  ["aesthetic.dark", ["ダーク", "陰鬱", "暗い雰囲気"]],
  ["aesthetic.bright", ["明るい", "快活", "陽気"]],
  ["aesthetic.scifi", ["SF", "宇宙", "サイバーパンク"]],
  ["aesthetic.fantasy", ["幻想", "ファンタジー", "魔法世界"]],
  ["compound.gap", ["ギャップ", "意外な一面"]],
  ["compound.tender_strength", ["強くて優しい", "強さと優しさ"]],
  ["compound.cold_kind", ["冷たいけれど優しい", "冷淡だが優しい", "不器用な優しさ"]],
];

type SourceField = "overview" | "likedAspects" | "dislikedAspects";

function firstKeyword(text: string, keywords: readonly string[]): string | undefined {
  return keywords.find((keyword) => text.includes(keyword));
}

export function localTraitExtraction(entry: CharacterEntryInput): TraitExtraction {
  const fields: Array<[SourceField, string | undefined]> = [
    ["overview", entry.overview],
    ["likedAspects", entry.likedAspects],
    ["dislikedAspects", entry.dislikedAspects],
  ];
  const assertions: TraitExtraction["assertions"] = [];
  const preferences: TraitExtraction["preferences"] = [];
  const seenAssertion = new Set<string>();
  const seenPreference = new Set<string>();

  for (const [field, text] of fields) {
    if (!text) continue;
    for (const [traitId, keywords] of KEYWORDS) {
      const quote = firstKeyword(text, keywords);
      if (!quote) continue;
      if (!seenAssertion.has(traitId)) {
        assertions.push({
          traitId,
          level: null,
          observation: "stated",
          confidence: field === "overview" ? 0.78 : 0.9,
          evidence: { field, quote },
        });
        seenAssertion.add(traitId);
      }
      if (field !== "overview") {
        const preferenceKey = `${field}:${traitId}`;
        if (!seenPreference.has(preferenceKey)) {
          preferences.push({
            traitId,
            polarity: field === "likedAspects" ? "positive" : "negative",
            strength: 0.9,
            evidence: { field, quote },
          });
          seenPreference.add(preferenceKey);
        }
      }
    }
  }
  return { assertions, preferences, freeTags: [] };
}

export function localGeneratedCharacter(brief: {
  primaryTraitIds: string[];
  supportingTraitIds: string[];
  avoidTraitIds: string[];
  explorationTraitIds: string[];
  mode: string;
  requestNote?: string;
}): GeneratedCharacter {
  const primary = brief.primaryTraitIds.map((id) => traitById.get(id)).filter((trait) => trait !== undefined);
  const supporting = brief.supportingTraitIds.map((id) => traitById.get(id)).filter((trait) => trait !== undefined);
  const labels = [...primary, ...supporting].map((trait) => trait.label);
  const name = brief.mode === "surprising" ? "綺星（きら）ノエ" : "白綴（しらつづり）ユラ";
  return {
    name,
    concept: `${labels.slice(0, 3).join("、") || "静かな強さ"}を軸にした、既存作品に属さないオリジナルキャラクター。`,
    appearance:
      "深い藍色を基調に、銀の留め具と使い込まれた小物を身につけている。派手さよりも、近づいたときに細部が伝わる装い。",
    personality: `一見すると距離を置いているが、行動には一貫した思いやりがある。${labels.join("、")}という特徴が、状況によって異なる形で表れる。`,
    valuesAndMotivation:
      "誰かに与えられた正解ではなく、自分で選んだ約束を守ることを大切にする。失われた居場所を、他者にも開かれた形で作り直そうとしている。",
    abilitiesAndWeaknesses:
      "状況を観察して小さな矛盾を見抜く力を持つ。一方で、自分の感情を説明することが苦手で、助けを求める判断が遅れやすい。",
    background:
      "移動図書館の記録係として各地を巡り、名前を失った物語を収集している。過去の失敗を隠すのではなく、記録として残すことで同じ過ちを防ごうとしている。",
    centralConflict:
      "真実を残す責任と、秘密を守ることで救われる人の間で揺れる。どちらか一方を選ばずに済む第三の方法を探すことが物語の中心になる。",
    relationships:
      "最初は役割を通じてのみ他者と関わるが、共同作業と小さな約束の積み重ねによって信頼を築く。対等に異論を言う相手を大切にする。",
    voiceAndMannerisms:
      "短く正確に話すが、安心した場面では乾いた冗談が増える。考えるとき、手元の紙片を無意識に折りたたむ癖がある。",
    storyHooks: [
      "記録から消された一つの町を探す旅に同行する。",
      "守るべき秘密が、別の誰かを傷つけていると知る。",
      "過去に対立した人物と、同じ資料を巡って一時的に協力する。",
    ],
    tasteRationale: primary
      .slice(0, 5)
      .map((trait) => ({ traitId: trait.id, reason: `${trait.label}を人物の行動と葛藤に反映しました。` })),
    explorationNotes: brief.explorationTraitIds.map(
      (id) => `${traitById.get(id)?.label ?? id}は、好みを広げる探索要素として控えめに加えています。`,
    ),
    safetyNotes: ["露骨な性的表現は含みません。", "特定の既存作品・キャラクターを参照していません。"],
  };
}
