export const understandingAspectLabels = {
  narrativeRole: "物語での役割",
  moralityOrientation: "善悪・道徳的な傾向",
  goals: "目的・目標",
  values: "重視する価値観",
  behavior: "行動・振る舞い",
  relationships: "他者との関係",
  expression: "表現・雰囲気",
} as const;

export type UnderstandingAspect = keyof typeof understandingAspectLabels;
export const understandingAspects = Object.keys(understandingAspectLabels) as UnderstandingAspect[];
