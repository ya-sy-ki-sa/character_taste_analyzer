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

export async function verifyEvidenceReference(
  evidence: EvidenceReference,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
): Promise<VerifiedEvidence> {
  if (evidence.sourceUrl && !allowedUrls.has(evidence.sourceUrl)) {
    throw new Error("EXTERNAL_CITATION_NOT_ALLOWED");
  }
  const inputPointer = canonicalEntryInputPointer(evidence.inputPointer);
  let source = inputPointer
    ? sources.find((item) => canonicalEntryInputPointer(item.inputPointer) === inputPointer)
    : evidence.sourceUrl
      ? sources.find((item) => item.url === evidence.sourceUrl)
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
