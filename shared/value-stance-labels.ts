const orientationLabels: Readonly<Record<string, string>> = {
  evil: "悪そのもの",
  immoral: "非道徳的なあり方",
  indifferent_to_good: "善への無関心",
  transgressive: "規範からの逸脱",
  self_defined: "自分で定めた規範",
  good: "善を重視する姿勢",
  mixed: "複数の価値傾向",
};

const stanceLabels: Readonly<Record<string, string>> = {
  affirm: "肯定的に捉える",
  accept: "受け入れる",
  indifferent: "善悪の判断対象にしない",
  ambivalent: "肯定・否定の両面がある",
  reject: "支持しない",
  unspecified: "判断は未指定",
};

export function valueOrientationLabel(value: string): string {
  return orientationLabels[value] ?? "その他の価値傾向";
}

export function valueStanceLabel(value: string): string {
  return stanceLabels[value] ?? "判断区分なし";
}
