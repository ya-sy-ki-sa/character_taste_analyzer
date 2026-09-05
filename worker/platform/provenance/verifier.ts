import type { CitationIssue } from "../../../shared/contracts/citations";
import { CitationRegistry } from "./registry";
import { canonicalSourceUrl } from "./urls";

export { canonicalSourceUrl } from "./urls";

import type { EvidenceReference } from "../../../shared/contracts/evidence";
import { canonicalEntryInputPointer } from "../../../shared/entry-input";
import { sha256Hex } from "../../lib/crypto";

export type ProvenanceSource = {
  sourceId: string;
  text: string;
  inputPointer: string | null;
  url: string | null;
  origin: "user_input" | "source";
};

export type VerifiedEvidence = {
  sourceId: string | null;
  evidenceOrigin: "user_input" | "source" | "model_knowledge";
  quoteStart: number | null;
  quoteEnd: number | null;
  quoteHash: string | null;
  excerptText: string | null;
  inputPointer: string | null;
  verificationStatus: "verified_quote" | "source_attributed" | "model_knowledge" | "invalid";
  inferenceType: EvidenceReference["inferenceType"];
  resolutionMethod?: "external_id" | "canonical_url" | "input_pointer" | "quote" | "model_knowledge";
  issueReason?: CitationIssue["reason"];
};

export class ProvenanceVerificationError extends Error {
  constructor(
    readonly code: "EXTERNAL_CITATION_NOT_ALLOWED",
    readonly safeDetail: string,
  ) {
    super(code);
  }
}

export async function verifyEvidenceReference(
  evidence: EvidenceReference,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
  registry?: CitationRegistry,
): Promise<VerifiedEvidence> {
  const canonicalAllowedUrls = new Set([...allowedUrls].map(canonicalSourceUrl));
  const canonicalEvidenceUrl = evidence.sourceUrl ? canonicalSourceUrl(evidence.sourceUrl) : null;
  const externalRef = evidence.sourceRef?.startsWith("external:") ? evidence.sourceRef : null;
  let matchedCanonicalUrl = canonicalEvidenceUrl;
  let resolutionMethod: VerifiedEvidence["resolutionMethod"];
  const invalidExternal = (issueReason: CitationIssue["reason"]): VerifiedEvidence => ({
    sourceId: null,
    evidenceOrigin: "source",
    quoteStart: null,
    quoteEnd: null,
    quoteHash: null,
    excerptText: evidence.quote,
    inputPointer: null,
    verificationStatus: "invalid",
    inferenceType: evidence.inferenceType,
    issueReason,
  });
  if (externalRef) {
    const catalog = registry ?? new CitationRegistry();
    if (!registry) await catalog.add([...allowedUrls].map((url) => ({ url, title: url })));
    const resolved = catalog.resolve(externalRef);
    if (!resolved || !canonicalAllowedUrls.has(resolved.url)) return invalidExternal("unknown_source_ref");
    if (canonicalEvidenceUrl && canonicalEvidenceUrl !== resolved.url) return invalidExternal("conflicting_reference");
    matchedCanonicalUrl = resolved.url;
    resolutionMethod = "external_id";
  } else if (canonicalEvidenceUrl) {
    if (!canonicalAllowedUrls.has(canonicalEvidenceUrl)) return invalidExternal("url_not_allowed");
    resolutionMethod = "canonical_url";
  }
  // An explicit external locator must never fall back to unrelated input or matching prose.
  const external = Boolean(externalRef || evidence.sourceUrl);
  if (external && (evidence.inputPointer || evidence.sourceRef?.startsWith("input:")))
    return invalidExternal("conflicting_reference");
  const inputPointer = canonicalEntryInputPointer(evidence.inputPointer);
  let source =
    !external && inputPointer
      ? sources.find((item) => canonicalEntryInputPointer(item.inputPointer) === inputPointer)
      : external
        ? sources.find((item) => item.url && canonicalSourceUrl(item.url) === matchedCanonicalUrl)
        : undefined;
  if (external && !source) return invalidExternal("source_unavailable");
  if (!source && evidence.sourceRef?.startsWith("input:")) {
    const pointer = canonicalEntryInputPointer(evidence.sourceRef.slice("input:".length));
    source = sources.find((item) => canonicalEntryInputPointer(item.inputPointer) === pointer);
  }
  if (source && !external) resolutionMethod = "input_pointer";
  if (!source && evidence.quote) {
    source = sources.find((item) => item.text.includes(evidence.quote ?? ""));
    if (source) resolutionMethod = "quote";
  }
  if (!source) {
    const normalizedRef = evidence.sourceRef?.normalize("NFKC").toLocaleLowerCase() ?? "";
    if (
      evidence.inferenceType !== "direct" ||
      normalizedRef.includes("model") ||
      normalizedRef.includes("モデル知識")
    ) {
      return {
        sourceId: null,
        evidenceOrigin: "model_knowledge",
        quoteStart: null,
        quoteEnd: null,
        quoteHash: null,
        excerptText: evidence.quote,
        inputPointer: null,
        verificationStatus: "model_knowledge",
        resolutionMethod: "model_knowledge",
        inferenceType: evidence.inferenceType,
      };
    }
    return {
      sourceId: null,
      evidenceOrigin: "model_knowledge",
      quoteStart: null,
      quoteEnd: null,
      quoteHash: null,
      excerptText: evidence.quote,
      inputPointer,
      verificationStatus: "invalid",
      issueReason: "source_unavailable",
      inferenceType: evidence.inferenceType,
    };
  }
  const quote = evidence.quote?.trim() || null;
  if (quote) {
    const start = source.text.indexOf(quote);
    if (start < 0 && evidence.inferenceType === "direct") {
      return {
        sourceId: source.sourceId,
        evidenceOrigin: source.origin,
        quoteStart: null,
        quoteEnd: null,
        quoteHash: null,
        excerptText: quote,
        inputPointer: source.inputPointer,
        verificationStatus: "invalid",
        resolutionMethod,
        issueReason: "quote_not_found",
        inferenceType: evidence.inferenceType,
      };
    }
    if (start >= 0) {
      return {
        sourceId: source.sourceId,
        evidenceOrigin: source.origin,
        quoteStart: start,
        quoteEnd: start + quote.length,
        quoteHash: await sha256Hex(quote),
        excerptText: quote,
        inputPointer: source.inputPointer,
        verificationStatus: "verified_quote",
        resolutionMethod,
        inferenceType: evidence.inferenceType,
      };
    }
  }
  return {
    sourceId: source.sourceId,
    evidenceOrigin: source.origin,
    quoteStart: null,
    quoteEnd: null,
    quoteHash: null,
    excerptText: quote,
    inputPointer: source.inputPointer,
    verificationStatus: "source_attributed",
    resolutionMethod,
    inferenceType: evidence.inferenceType,
  };
}
