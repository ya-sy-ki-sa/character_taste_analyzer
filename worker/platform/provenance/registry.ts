import { sha256Hex } from "../../lib/crypto";
import { canonicalSourceUrl } from "./urls";

export const CITATION_POLICY_VERSION = "external-id/v1.0.0";
export const CITATION_INSTRUCTION = `外部出典は出典台帳のsourceRefをそのまま使い、sourceUrlはnullにする。台帳のURLを再入力・修復したりIDを創作しない。今回のWeb検索で初めて取得した出典だけは検索注釈のURLをそのまま使ってよい。監査では台帳のIDへ対応付け、不明な対応は元の参照を残し不確実性を明示する。照合不能な根拠を別資料やモデル知識に置き換えてはいけない。`;

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
