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

const MAX_APPROXIMATE_URL_DISTANCE = 5;
const APPROXIMATE_URL_DISTANCE_RATIO = 0.02;
const MAX_PERCENT_ENCODING_REPAIRS = 3;
const MAX_PERCENT_ENCODING_REPAIR_CANDIDATES = 20_000;
const HEX_DIGITS = "0123456789ABCDEFabcdef";

function percentByteAt(value: string, index: number): number | null {
  if (value[index] !== "%" || !/^[0-9A-Fa-f]{2}$/u.test(value.slice(index + 1, index + 3))) return null;
  return Number.parseInt(value.slice(index + 1, index + 3), 16);
}

function utf8SequenceLength(firstByte: number): number | null {
  if (firstByte >= 0xc2 && firstByte <= 0xdf) return 2;
  if (firstByte >= 0xe0 && firstByte <= 0xef) return 3;
  if (firstByte >= 0xf0 && firstByte <= 0xf4) return 4;
  return null;
}

function percentEncodingRepairs(value: string): Set<string> {
  const repairs = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "%" &&
      /^[0-9A-Fa-f]$/u.test(value[index + 1] ?? "") &&
      !/^[0-9A-Fa-f]$/u.test(value[index + 2] ?? "")
    ) {
      for (const digit of HEX_DIGITS) repairs.add(`${value.slice(0, index + 2)}${digit}${value.slice(index + 2)}`);
    }

    const firstByte = percentByteAt(value, index);
    const sequenceLength = firstByte === null ? null : utf8SequenceLength(firstByte);
    if (!sequenceLength) continue;
    const prefixBytes = [firstByte];
    let nextIndex = index + 3;
    while (prefixBytes.length < sequenceLength) {
      const continuation = percentByteAt(value, nextIndex);
      if (continuation === null || continuation < 0x80 || continuation > 0xbf) break;
      prefixBytes.push(continuation);
      nextIndex += 3;
    }
    if (prefixBytes.length >= sequenceLength) continue;

    const repeatedFirstByte = percentByteAt(value, nextIndex);
    if (repeatedFirstByte !== firstByte) continue;
    const repeatedBytes = [repeatedFirstByte];
    let repeatedIndex = nextIndex + 3;
    while (repeatedBytes.length < sequenceLength) {
      const continuation = percentByteAt(value, repeatedIndex);
      if (continuation === null || continuation < 0x80 || continuation > 0xbf) break;
      repeatedBytes.push(continuation);
      repeatedIndex += 3;
    }
    if (
      repeatedBytes.length === sequenceLength &&
      prefixBytes.every((byte, prefixIndex) => repeatedBytes[prefixIndex] === byte)
    ) {
      repairs.add(`${value.slice(0, index)}${value.slice(nextIndex)}`);
    }
  }
  return repairs;
}

function percentEncodingRepairAllowedUrl(evidenceValue: string, allowedValues: Set<string>): string | null {
  let evidenceUrl: URL;
  try {
    evidenceUrl = new URL(evidenceValue);
  } catch {
    return null;
  }
  const allowedByTarget = new Map<string, string>();
  for (const allowedValue of allowedValues) {
    try {
      const allowedUrl = new URL(allowedValue);
      if (allowedUrl.origin === evidenceUrl.origin)
        allowedByTarget.set(`${allowedUrl.pathname}${allowedUrl.search}`, allowedValue);
    } catch {
      // Invalid allowlist entries cannot be repaired or matched.
    }
  }

  const initialTarget = `${evidenceUrl.pathname}${evidenceUrl.search}`;
  const visited = new Set([initialTarget]);
  let frontier = new Set([initialTarget]);
  const matches = new Set<string>();
  for (let repairCount = 1; repairCount <= MAX_PERCENT_ENCODING_REPAIRS; repairCount += 1) {
    const nextFrontier = new Set<string>();
    for (const candidate of frontier) {
      for (const repaired of percentEncodingRepairs(candidate)) {
        if (visited.has(repaired)) continue;
        visited.add(repaired);
        const allowedValue = allowedByTarget.get(repaired);
        if (allowedValue) matches.add(allowedValue);
        if (visited.size > MAX_PERCENT_ENCODING_REPAIR_CANDIDATES) return null;
        nextFrontier.add(repaired);
      }
    }
    frontier = nextFrontier;
    if (!frontier.size) break;
  }
  return matches.size === 1 ? ([...matches][0] ?? null) : null;
}

function boundedLevenshteinDistance(left: string, right: string, maximum: number): number | null {
  if (Math.abs(left.length - right.length) > maximum) return null;
  let previous = new Map<number, number>();
  for (let index = 0; index <= Math.min(right.length, maximum); index += 1) previous.set(index, index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Map<number, number>();
    if (leftIndex <= maximum) current.set(0, leftIndex);
    const start = Math.max(1, leftIndex - maximum);
    const end = Math.min(right.length, leftIndex + maximum);
    for (let rightIndex = start; rightIndex <= end; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        (current.get(rightIndex - 1) ?? Number.POSITIVE_INFINITY) + 1,
        (previous.get(rightIndex) ?? Number.POSITIVE_INFINITY) + 1,
        (previous.get(rightIndex - 1) ?? Number.POSITIVE_INFINITY) + substitutionCost,
      );
      if (distance <= maximum) current.set(rightIndex, distance);
    }
    if (!current.size) return null;
    previous = current;
  }
  return previous.get(right.length) ?? null;
}

function approximateAllowedUrl(evidenceValue: string, allowedValues: Set<string>): string | null {
  let evidenceUrl: URL;
  try {
    evidenceUrl = new URL(evidenceValue);
  } catch {
    return null;
  }
  const evidenceTarget = `${evidenceUrl.pathname}${evidenceUrl.search}`;
  let closest: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let ambiguous = false;

  for (const allowedValue of allowedValues) {
    let allowedUrl: URL;
    try {
      allowedUrl = new URL(allowedValue);
    } catch {
      continue;
    }
    if (allowedUrl.origin !== evidenceUrl.origin) continue;
    const allowedTarget = `${allowedUrl.pathname}${allowedUrl.search}`;
    const comparisonLength = Math.max(evidenceTarget.length, allowedTarget.length);
    const maximumDistance = Math.min(
      MAX_APPROXIMATE_URL_DISTANCE,
      Math.floor(comparisonLength * APPROXIMATE_URL_DISTANCE_RATIO),
    );
    if (maximumDistance < 1) continue;
    const distance = boundedLevenshteinDistance(evidenceTarget, allowedTarget, maximumDistance);
    if (distance === null || distance > closestDistance) continue;
    if (distance === closestDistance) {
      ambiguous = true;
      continue;
    }
    closest = allowedValue;
    closestDistance = distance;
    ambiguous = false;
  }

  return ambiguous ? null : closest;
}

export async function verifyEvidenceReference(
  evidence: EvidenceReference,
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
): Promise<VerifiedEvidence> {
  const canonicalAllowedUrls = new Set([...allowedUrls].map(canonicalSourceUrl));
  const canonicalEvidenceUrl = evidence.sourceUrl ? canonicalSourceUrl(evidence.sourceUrl) : null;
  const matchedCanonicalUrl = canonicalEvidenceUrl
    ? canonicalAllowedUrls.has(canonicalEvidenceUrl)
      ? canonicalEvidenceUrl
      : (percentEncodingRepairAllowedUrl(canonicalEvidenceUrl, canonicalAllowedUrls) ??
        approximateAllowedUrl(canonicalEvidenceUrl, canonicalAllowedUrls))
    : null;
  if (evidence.sourceUrl && !matchedCanonicalUrl) {
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
      ? sources.find((item) => item.url && canonicalSourceUrl(item.url) === matchedCanonicalUrl)
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
        sourceId: null,
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
      sourceId: null,
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
        sourceId: source.sourceId,
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
        sourceId: source.sourceId,
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
    sourceId: source.sourceId,
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
