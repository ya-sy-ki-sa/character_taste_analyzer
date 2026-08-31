import {
  type AnyEntryDraft,
  canonicalEntryInputPointer,
  entryBaseCharacterName,
  entryReferenceMaterial,
} from "../../shared/schemas";

type MarkdownEvidence = {
  verificationStatus: string;
  inferenceType: string;
  quote: string | null;
  inputPointer: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceProvider: string | null;
  trustReason: string | null;
};

type MarkdownAssertion = {
  raw_label: string;
  value_text: string;
  explicitness: string;
  confidence: number;
  status: string;
  evidence: MarkdownEvidence[];
};

type MarkdownDelta = {
  operation: string;
  before_value: string | null;
  after_value: string | null;
  reason_text: string | null;
  confidence: number;
  status: string;
};

type MarkdownUnderstanding = {
  sourceAssessment: { coverage: string; limitations: string[] };
  summary: Record<string, string | string[]>;
  uncertainties: Array<{ topic: string; reason: string }>;
  confidence: number;
  assertions: MarkdownAssertion[];
  deltas?: MarkdownDelta[];
};

export type CharacterMarkdownSource = {
  entry: { id: string; status: string; draft: AnyEntryDraft };
  understanding: MarkdownUnderstanding | null;
  baseUnderstanding: MarkdownUnderstanding | null;
};

const registrationTypeLabels = {
  existing: "既成キャラクター",
  customized_existing: "既成キャラクター（カスタム）",
  original: "オリジナルキャラクター",
} as const;

const representationTypeLabels: Record<string, string> = {
  facet: "特定の側面",
  scene_state: "特定の場面・状態",
  alternate_setting: "別設定",
  transformative: "二次創作",
  user_interpretation: "独自解釈",
};

const summaryLabels: Record<string, string> = {
  identity: "人物像",
  narrativeRole: "物語での役割",
  moralityOrientation: "善悪・道徳的な傾向",
  goals: "目的・目標",
  values: "重視する価値観",
  behavior: "行動・振る舞い",
  relationships: "他者との関係",
  expression: "表現・雰囲気",
};

const coverageLabels: Record<string, string> = {
  sufficient: "十分",
  partial: "一部不足",
  minimal: "最小限",
  none: "情報なし",
};

const evidenceStatusLabels: Record<string, string> = {
  verified_quote: "原文照合済み",
  source_attributed: "出典のみ確認",
  model_knowledge: "モデル知識",
  invalid: "根拠を検証できません",
};

const inferenceLabels: Record<string, string> = {
  direct: "直接引用",
  paraphrase: "要約・言い換え",
  inferred: "推論",
};

const explicitnessLabels: Record<string, string> = {
  source_explicit: "資料に明記",
  source_interpreted: "資料から解釈",
  user_explicit: "ユーザーが明記",
  user_confirmed: "ユーザー確認済み",
  model_knowledge: "モデル知識",
};

const deltaLabels: Record<string, string> = {
  add: "新しく追加された設定",
  modify: "内容が変更された設定",
  remove: "取り除かれた設定",
  invert: "反対になった設定",
  narrow_scope: "範囲が限定された設定",
  emphasize: "より強調された設定",
  inherit: "原典から引き継いだ設定",
  unspecified: "その他の変更",
};

function inline(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_{}[\]<>#+|])/gu, "\\$1")
    .replace(/\r?\n/gu, "<br>")
    .trim();
}

function paragraph(value: unknown): string {
  return String(value ?? "")
    .trim()
    .split(/\r?\n/gu)
    .map((line) => inline(line))
    .join("  \n");
}

function field(lines: string[], label: string, value: unknown): void {
  const text = paragraph(value);
  if (text) lines.push(`### ${label}`, "", text, "");
}

function isPreferenceEvidence(evidence: MarkdownEvidence): boolean {
  const pointer = canonicalEntryInputPointer(evidence.inputPointer);
  return pointer === "/preferenceContext" || pointer?.startsWith("/preference/") === true;
}

function appendEvidence(lines: string[], evidence: MarkdownEvidence[]): void {
  const characterEvidence = evidence.filter((item) => !isPreferenceEvidence(item));
  if (!characterEvidence.length) return;
  lines.push("##### 根拠", "");
  for (const item of characterEvidence) {
    const status = evidenceStatusLabels[item.verificationStatus] ?? "検証状態未分類";
    const inference = inferenceLabels[item.inferenceType] ?? "根拠形式未分類";
    lines.push(`- **${status}／${inference}**`);
    if (item.quote) lines.push(`  - 引用: ${inline(item.quote)}`);
    if (item.sourceTitle) lines.push(`  - 出典: ${inline(item.sourceTitle)}`);
    if (item.sourceProvider) lines.push(`  - 取得元: ${inline(item.sourceProvider)}`);
    if (item.trustReason) lines.push(`  - 採用理由: ${inline(item.trustReason)}`);
    if (item.sourceUrl) lines.push(`  - URL: ${inline(item.sourceUrl)}`);
  }
  lines.push("");
}

function appendUnderstanding(lines: string[], title: string, understanding: MarkdownUnderstanding): void {
  lines.push(`## ${title}`, "");
  lines.push(`- 情報充足度: ${coverageLabels[understanding.sourceAssessment.coverage] ?? "未分類"}`);
  lines.push(`- 全体登録内支持度: ${Math.round(understanding.confidence * 100)}%`, "");
  for (const [key, value] of Object.entries(understanding.summary)) {
    const normalized = Array.isArray(value) ? value.join("、") : value;
    field(lines, summaryLabels[key] ?? "その他の特徴", normalized);
  }
  if (understanding.assertions.length) {
    lines.push("### 抽出属性", "");
    for (const assertion of understanding.assertions) {
      lines.push(`#### ${inline(assertion.raw_label)}`, "", paragraph(assertion.value_text), "");
      lines.push(
        `- 根拠の明示性: ${explicitnessLabels[assertion.explicitness] ?? "未分類"}`,
        `- 登録内支持度: ${Math.round(assertion.confidence * 100)}%`,
        `- 状態: ${inline(assertion.status)}`,
        "",
      );
      appendEvidence(lines, assertion.evidence);
    }
  }
  if (understanding.sourceAssessment.limitations.length) {
    lines.push("### 情報上の制約", "");
    for (const limitation of understanding.sourceAssessment.limitations) lines.push(`- ${inline(limitation)}`);
    lines.push("");
  }
  if (understanding.uncertainties.length) {
    lines.push("### 不確実な点", "");
    for (const uncertainty of understanding.uncertainties)
      lines.push(`- **${inline(uncertainty.topic)}**: ${inline(uncertainty.reason)}`);
    lines.push("");
  }
}

function appendDeltas(lines: string[], deltas: MarkdownDelta[], characterName: string): void {
  if (!deltas.length) return;
  lines.push("## 原典からどのように変わっているか", "");
  for (const delta of deltas) {
    lines.push(`### ${deltaLabels[delta.operation] ?? "設定の変更"}`, "");
    lines.push(`- 原典の設定: ${inline(delta.before_value ?? "該当する設定なし")}`);
    lines.push(`- ${inline(characterName)}の設定: ${inline(delta.after_value ?? "このキャラクター像では適用しない")}`);
    if (delta.reason_text) lines.push(`- 判定理由: ${inline(delta.reason_text)}`);
    lines.push(`- 登録内支持度: ${Math.round(delta.confidence * 100)}%`, `- 状態: ${inline(delta.status)}`, "");
  }
}

export function buildCharacterMarkdown(source: CharacterMarkdownSource): string {
  const draft = source.entry.draft;
  const lines = [`# ${inline(draft.characterName)}`, "", "## 登録情報", ""];
  lines.push(`- 登録種別: ${registrationTypeLabels[draft.registrationType]}`);
  lines.push(`- キャラクター名: ${inline(draft.characterName)}`);
  if (draft.registrationType !== "original") {
    lines.push(`- 作品名: ${inline(draft.workTitle)}`);
    if (draft.mediaType) lines.push(`- 媒体・版: ${inline(draft.mediaType)}`);
  }
  if (draft.registrationType === "customized_existing") {
    lines.push(`- 既成キャラクター名: ${inline(entryBaseCharacterName(draft))}`);
    lines.push(`- カスタムの種類: ${representationTypeLabels[draft.representationType] ?? "未分類"}`);
  }
  lines.push("");
  if (draft.registrationType === "original") field(lines, "キャラクター基本情報", draft.characterBasicInfo);
  if (draft.registrationType === "customized_existing")
    field(lines, "基本像からどう違うか", draft.customizationDescription);
  const referenceMaterial = entryReferenceMaterial(draft);
  if (referenceMaterial) field(lines, "解析に加えた参考情報", referenceMaterial);
  if (draft.userCharacterView) field(lines, "ユーザーのキャラクター解釈", draft.userCharacterView);
  if ("darkContext" in draft) {
    field(lines, "注目するダーク状態", draft.darkContext.focusDescription);
    field(lines, "変化前・通常時", draft.darkContext.beforeState);
    field(lines, "闇化・敵対化の契機", draft.darkContext.transitionTrigger);
    field(lines, "支配者・影響源", draft.darkContext.controllerOrInfluence);
    field(lines, "支配・変化の機構", draft.darkContext.controlMechanism);
    field(lines, "認識・抵抗・自我", draft.darkContext.awarenessAndResistance);
    field(lines, "関係の変化", draft.darkContext.relationshipChange);
    field(lines, "責任の捉え方", draft.darkContext.responsibilityNote);
    field(lines, "望む結末", draft.darkContext.desiredOutcome);
    field(lines, "内容境界", draft.darkContext.contentBoundaries);
  }
  if (source.baseUnderstanding) appendUnderstanding(lines, "既成キャラクターの基本像", source.baseUnderstanding);
  if (source.understanding)
    appendUnderstanding(
      lines,
      source.baseUnderstanding ? "対象像・基本像からの差分" : "キャラクター像",
      source.understanding,
    );
  if (source.understanding?.deltas) appendDeltas(lines, source.understanding.deltas, source.entry.draft.characterName);
  return `${lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()}\n`;
}

export function characterMarkdownFilename(draft: AnyEntryDraft): string {
  const forbiddenFilenameCharacters = new Set(Array.from('<>:"/\\|?*'));
  const safeName = Array.from(draft.characterName.normalize("NFKC"))
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f || forbiddenFilenameCharacters.has(character) ? "_" : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim()
    .slice(0, 80);
  return `${safeName || "character"}-登録情報.md`;
}
