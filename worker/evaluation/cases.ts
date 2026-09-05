import type { AnalysisDomain } from "../../shared/analysis-domain";
import { frozenDarkAnalyzerFixtures, frozenOutOfScopeFixtures } from "../../tests/fixtures/dark-analyzer-fixtures";

export const QUALITY_FIXTURE_VERSION = "quality/v1";
export type QualityCase = {
  id: string;
  domain: AnalysisDomain;
  basicInfo: string;
  likedReasons: string;
  dislikedReasons?: string;
  scope?: string;
  focus?: string;
  expectedChannels: string[];
  expectsEmpty?: boolean;
};
export const qualityCases: QualityCase[] = [
  {
    id: "standard-narrative",
    domain: "standard",
    basicInfo: "冷静で計算高い敵役。仲間を裏切って自分の目的を追う。",
    likedReasons: "裏切りで物語を面白くするところが好き。自分が同じようになりたいわけではない。",
    expectedChannels: ["narrative_interest"],
  },
  {
    id: "standard-admiration",
    domain: "standard",
    basicInfo: "冷静で計算高い人物。困難でも目的を見失わずに行動する。",
    likedReasons: "自分もこの人のように冷静に判断できるようになりたい。",
    expectedChannels: ["wishful_identification", "admiration"],
  },
  {
    id: "standard-conditional",
    domain: "standard",
    basicInfo: "敵には冷徹に振る舞うが、仲間には親切な人物。",
    likedReasons: "敵に対する冷徹さは物語を面白くするので好き。",
    dislikedReasons: "仲間にまで冷たくなるのは苦手。",
    scope: "敵対場面と仲間との場面を区別",
    expectedChannels: ["narrative_interest"],
  },
  {
    id: "standard-empty",
    domain: "standard",
    basicInfo: "旅をしている人物。人物像をまだ詳しく決めていない。",
    likedReasons: "",
    expectedChannels: [],
    expectsEmpty: true,
  },
  ...frozenDarkAnalyzerFixtures.map((item) => ({
    id: item.id,
    domain: "dark" as const,
    basicInfo: `${item.beforeState}。${item.transition}。`,
    likedReasons: item.preferenceReason,
    focus: item.focusDescription,
    expectedChannels: [item.expected.responseChannel],
  })),
];
// The frozen dark out-of-scope set remains a separately reported scope benchmark.
export const darkScopeControls = frozenOutOfScopeFixtures;
