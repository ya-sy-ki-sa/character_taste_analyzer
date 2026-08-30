import { canonicalEntryInputPointer, type EvidenceReference } from "../../shared/schemas";
import { sha256Hex } from "../lib/crypto";

export type ProvenanceSource = {
  fragmentId: string;
  text: string;
  inputPointer: string | null;
  url: string | null;
  origin: "user_input" | "source";
};

export type VerifiedEvidence = {
  sourceFragmentId: string | null;
  evidenceOrigin: "user_input" | "source" | "model_knowledge";
  quoteStart: number | null;
  quoteEnd: number | null;
  quoteHash: string | null;
  excerptText: string | null;
  inputPointer: string | null;
  verificationStatus: "verified_quote" | "source_attributed" | "model_knowledge" | "invalid";
  inferenceType: EvidenceReference["inferenceType"];
};

export class ProvenanceVerificationError extends Error {
  constructor(
    readonly code: "EXTERNAL_CITATION_NOT_ALLOWED",
    readonly safeDetail: string,
  ) {
    super(code);
  }
}

const TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export function canonicalSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMETERS.has(key.toLocaleLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value;
  }
}

export async function verifyEvidenceReference(
  evidence: EvidenceReference,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
): Promise<VerifiedEvidence> {
  const canonicalAllowedUrls = new Set([...allowedUrls].map(canonicalSourceUrl));
  const canonicalEvidenceUrl = evidence.sourceUrl ? canonicalSourceUrl(evidence.sourceUrl) : null;
  if (evidence.sourceUrl && canonicalEvidenceUrl && !canonicalAllowedUrls.has(canonicalEvidenceUrl)) {
    const allowed = [...allowedUrls];
    const allowedSummary = allowed.length
      ? `${allowed.slice(0, 5).join("、")}${allowed.length > 5 ? `（ほか${allowed.length - 5}件）` : ""}`
      : "なし";
    throw new ProvenanceVerificationError(
      "EXTERNAL_CITATION_NOT_ALLOWED",
      `LLMの構造化応答は取得済みですが、回答内の参照URLがWeb Search注釈・収集済み出典にありません。このエラー自体はOpenAIの拒否やセンシティブ判定を示しません。参照URL: ${evidence.sourceUrl}／照合可能な出典: ${allowedSummary}`,
    );
  }
  const inputPointer = canonicalEntryInputPointer(evidence.inputPointer);
  let source = inputPointer
    ? sources.find((item) => canonicalEntryInputPointer(item.inputPointer) === inputPointer)
    : evidence.sourceUrl
      ? sources.find((item) => item.url && canonicalSourceUrl(item.url) === canonicalEvidenceUrl)
      : undefined;
  if (!source && evidence.sourceRef?.startsWith("input:")) {
    const pointer = canonicalEntryInputPointer(evidence.sourceRef.slice("input:".length));
    source = sources.find((item) => canonicalEntryInputPointer(item.inputPointer) === pointer);
  }
  if (!source && evidence.quote) source = sources.find((item) => item.text.includes(evidence.quote ?? ""));
  if (!source) {
    const normalizedRef = evidence.sourceRef?.normalize("NFKC").toLocaleLowerCase() ?? "";
    if (
      evidence.inferenceType !== "direct" ||
      normalizedRef.includes("model") ||
      normalizedRef.includes("モデル知識")
    ) {
      return {
        sourceFragmentId: null,
        evidenceOrigin: "model_knowledge",
        quoteStart: null,
        quoteEnd: null,
        quoteHash: null,
        excerptText: evidence.quote,
        inputPointer: null,
        verificationStatus: "model_knowledge",
        inferenceType: evidence.inferenceType,
      };
    }
    return {
      sourceFragmentId: null,
      evidenceOrigin: "model_knowledge",
      quoteStart: null,
      quoteEnd: null,
      quoteHash: null,
      excerptText: evidence.quote,
      inputPointer,
      verificationStatus: "invalid",
      inferenceType: evidence.inferenceType,
    };
  }
  const quote = evidence.quote?.trim() || null;
  if (quote) {
    const start = source.text.indexOf(quote);
    if (start < 0 && evidence.inferenceType === "direct") {
      return {
        sourceFragmentId: source.fragmentId,
        evidenceOrigin: source.origin,
        quoteStart: null,
        quoteEnd: null,
        quoteHash: null,
        excerptText: quote,
        inputPointer: source.inputPointer,
        verificationStatus: "invalid",
        inferenceType: evidence.inferenceType,
      };
    }
    if (start >= 0) {
      return {
        sourceFragmentId: source.fragmentId,
        evidenceOrigin: source.origin,
        quoteStart: start,
        quoteEnd: start + quote.length,
        quoteHash: await sha256Hex(quote),
        excerptText: quote,
        inputPointer: source.inputPointer,
        verificationStatus: "verified_quote",
        inferenceType: evidence.inferenceType,
      };
    }
  }
  return {
    sourceFragmentId: source.fragmentId,
    evidenceOrigin: source.origin,
    quoteStart: null,
    quoteEnd: null,
    quoteHash: null,
    excerptText: quote,
    inputPointer: source.inputPointer,
    verificationStatus: "source_attributed",
    inferenceType: evidence.inferenceType,
  };
}
