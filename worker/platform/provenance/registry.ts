import { sha256Hex } from "../../lib/crypto";
import { canonicalSourceUrl } from "./urls";

export const CITATION_POLICY_VERSION = "external-id/v1.1.0";
export const CITATION_INSTRUCTION = `[REFERENCE_RULES:EXTERNAL_CITATION]
- 出典台帳にある外部出典 → sourceRefは台帳の値をそのまま使用し、sourceUrl=null。
- 台帳のURLの再入力・修復、IDの創作を禁止する。
- 今回のWeb検索で初めて取得した出典のみ → 検索注釈のURLをそのまま使用可能。
- 監査時 → 台帳のIDへ対応付ける。
- 対応が不明 → 元の参照を保持し、不確実性を明示する。
- 照合不能な根拠を別資料・モデル知識へ置き換えない。`;

export class CitationRegistry {
  private readonly sources = new Map<string, { sourceRef: string; url: string; title: string }>();

  async add(sources: ReadonlyArray<{ url: string; title: string }>) {
    for (const source of sources) {
      // Only URLs supplied by trusted collection paths belong in this registry.
      const url = canonicalSourceUrl(source.url);
      try {
        if (!["http:", "https:"].includes(new URL(url).protocol)) continue;
      } catch {
        continue;
      }
      if (this.sources.has(url)) continue;
      this.sources.set(url, { sourceRef: `external:${await sha256Hex(url)}`, url, title: source.title });
    }
  }

  resolve(sourceRef: string) {
    return [...this.sources.values()].find((source) => source.sourceRef === sourceRef);
  }

  entries() {
    return [...this.sources.values()];
  }
}
