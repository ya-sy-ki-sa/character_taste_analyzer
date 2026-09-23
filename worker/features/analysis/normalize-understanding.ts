import type { GroundedUnderstandingAudit } from "../../../shared/contracts/semantic-audit";
import { type UnderstandingAudit, understandingAuditSchema } from "../../../shared/contracts/understanding-quality";
import { type UnderstandingAspect, understandingAspects } from "../../../shared/understanding-aspects";
import type { verifySemanticAssertion } from "./semantic-integrity";
import {
  isConcreteUnderstandingAssertion,
  stableKeyUnderstandingAspect,
  understandingAssertionAspects,
} from "./understanding-aspects";
import { assessUnderstandingInformation } from "./understanding-quality";

type Verified = Awaited<ReturnType<typeof verifySemanticAssertion>>;
type Assertion = GroundedUnderstandingAudit["assertions"][number];
type Row = {
  assertion: Assertion;
  verified: Verified;
  sourceIndex: number;
  aspects: Set<UnderstandingAspect>;
  grounded: boolean;
  contextKey: string;
  propositionKey: string;
  evidenceKey: string;
};

export const UNDERSTANDING_PROVENANCE_BUDGET = {
  groundedPerAspect: 3,
  modelPerAspect: 3,
  modelTotal: 14,
  modelOnlyMissingAspect: false,
} as const;

export const UNDERSTANDING_CONSTRAINED_BUDGET = {
  groundedPerAspect: 2,
  modelPerAspect: 1,
  modelTotal: 4,
  modelOnlyMissingAspect: true,
} as const;

type UnderstandingBudget = {
  groundedPerAspect: number;
  modelPerAspect: number;
  modelTotal: number;
  modelOnlyMissingAspect: boolean;
};

export type NormalizedUnderstanding = UnderstandingAudit & {
  informationQuality: ReturnType<typeof assessUnderstandingInformation>;
  /** Internal commit alignment; these fields are not part of the generated candidate. */
  canonicalSourceIndexes: number[];
  canonicalProofs: Verified[];
};

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[。.!！]+$/gu, "");
}

function contextKey(assertion: Assertion): string {
  const scope = assertion.scopeAssessment;
  return JSON.stringify([
    normalizedText(scope.actor ?? ""),
    normalizedText(scope.target ?? ""),
    normalizedText(scope.possessor ?? ""),
    normalizedText(scope.negatedProposition ?? ""),
    normalizedText(assertion.scopeText),
    assertion.assertionKind,
  ]);
}

function evidenceKey(proofs: Verified["evidence"]): string {
  return JSON.stringify(
    proofs
      .map((proof) => [
        proof.verificationStatus,
        proof.evidenceOrigin,
        proof.sourceId ?? null,
        proof.inputPointer ?? null,
        proof.quoteHash ?? null,
        normalizedText(proof.excerptText ?? ""),
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

function assertionAspects(audit: GroundedUnderstandingAudit, assertion: Assertion, index: number) {
  if (!isConcreteUnderstandingAssertion(assertion)) return new Set<UnderstandingAspect>();
  const deterministic = understandingAssertionAspects(assertion);
  return new Set(
    deterministic.length
      ? deterministic
      : understandingAspects.filter((aspect) => audit.aspectAssessments[aspect].assertionIndexes.includes(index)),
  );
}

function rowFor(audit: GroundedUnderstandingAudit, assertion: Assertion, proof: Verified, index: number): Row | null {
  if (!proof.keep) return null;
  const groundedEvidence = proof.evidence.filter((item) =>
    ["verified_quote", "source_attributed"].includes(item.verificationStatus),
  );
  const modelEvidence = proof.evidence.filter((item) => item.verificationStatus === "model_knowledge");
  // A partially supported compound cannot inherit a grounded label for its
  // unverified clause. Separately supported complete assertions still survive.
  const fullGroundedSupport =
    assertion.evidenceSetAssessment?.verdict === "supported" ||
    assertion.evidence.some(
      (item) => item.sourceRef !== "model_knowledge" && item.supportAssessment.verdict === "supported",
    );
  const grounded = groundedEvidence.length > 0 && (!modelEvidence.length || fullGroundedSupport);
  if (!grounded && !modelEvidence.length) return null;
  const retainedEvidence = grounded ? groundedEvidence : modelEvidence;
  // The semantic verifier deliberately keeps the model_knowledge label when a
  // generated candidate later finds a supporting source. Preserve that proof
  // without claiming official confirmation.
  const explicitness = grounded
    ? proof.explicitness === "model_knowledge"
      ? "source_interpreted"
      : proof.explicitness
    : "model_knowledge";
  const checked = {
    ...proof,
    explicitness,
    confidence: grounded ? proof.confidence : Math.min(proof.confidence, 0.45),
    evidence: retainedEvidence,
  };
  const nextAssertion = {
    ...assertion,
    confidence: checked.confidence,
    explicitness: explicitness as Assertion["explicitness"],
    evidence: assertion.evidence.filter((item) =>
      grounded ? item.sourceRef !== "model_knowledge" : item.sourceRef === "model_knowledge",
    ),
  };
  return {
    assertion: nextAssertion,
    verified: checked,
    sourceIndex: index,
    aspects: assertionAspects(audit, nextAssertion, index),
    grounded,
    contextKey: contextKey(nextAssertion),
    propositionKey: normalizedText(nextAssertion.valueText),
    evidenceKey: evidenceKey(retainedEvidence),
  };
}

function splitSupportedSentences(rows: Row[], reclassifyAfterSplit: boolean): void {
  const grounded = rows.filter((row) => row.grounded);
  for (const row of rows) {
    if (row.grounded) continue;
    const sentences = row.assertion.valueText.match(/[^。！？.!?]+[。！？.!?]?/gu) ?? [];
    if (sentences.length < 2) continue;
    const remaining = sentences.filter(
      (sentence) =>
        !grounded.some(
          (candidate) =>
            candidate.contextKey === row.contextKey && candidate.propositionKey === normalizedText(sentence),
        ),
    );
    if (remaining.length === sentences.length) continue;
    // The original ontology key may have described the removed clause.
    row.assertion = {
      ...row.assertion,
      attributeStableKey: reclassifyAfterSplit ? null : row.assertion.attributeStableKey,
      valueText: remaining.join("").trim(),
    };
    row.propositionKey = normalizedText(row.assertion.valueText);
    const aspects = understandingAssertionAspects(row.assertion);
    if (aspects.length) row.aspects = new Set(aspects);
  }
}

function deduplicate(rows: Row[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const row of rows) {
    if (!row.propositionKey) continue;
    const key = JSON.stringify([
      row.propositionKey,
      row.contextKey,
      row.assertion.attributeStableKey,
      row.evidenceKey,
      row.grounded,
    ]);
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, row);
      continue;
    }
    for (const aspect of row.aspects) prior.aspects.add(aspect);
    if (row.verified.confidence > prior.verified.confidence) {
      prior.assertion = row.assertion;
      prior.verified = row.verified;
      prior.sourceIndex = row.sourceIndex;
    }
  }
  return [...byKey.values()];
}

function rank(row: Row): number {
  const provenance = {
    user_explicit: 4,
    source_explicit: 3,
    source_interpreted: 2,
    model_knowledge: 1,
  }[row.assertion.explicitness];
  const quote = row.verified.evidence.some((proof) => proof.verificationStatus === "verified_quote") ? 0.5 : 0;
  const official = row.verified.evidence.some((proof) => ["official", "primary"].includes(proof.sourceType ?? ""))
    ? 0.25
    : 0;
  return provenance * 10 + quote + official + row.verified.confidence;
}

function selectByBudget(rows: Row[], budget: UnderstandingBudget) {
  const selected = new Set<Row>();
  const aspectRows = new Map<UnderstandingAspect, Row[]>(understandingAspects.map((aspect) => [aspect, []]));
  const ordered = (items: Row[]) => [...items].sort((a, b) => rank(b) - rank(a) || a.sourceIndex - b.sourceIndex);
  const grounded = rows.filter((row) => row.grounded);
  for (const aspect of understandingAspects) {
    const picked = ordered(grounded.filter((row) => row.aspects.has(aspect))).slice(0, budget.groundedPerAspect);
    aspectRows.set(aspect, picked);
    for (const row of picked) selected.add(row);
  }
  const groundedPropositions = new Set(grounded.map((row) => JSON.stringify([row.propositionKey, row.contextKey])));
  let modelCount = 0;
  for (const aspect of understandingAspects) {
    if (budget.modelOnlyMissingAspect && aspectRows.get(aspect)?.length) continue;
    const candidates = ordered(
      rows.filter(
        (row) =>
          !row.grounded &&
          row.aspects.has(aspect) &&
          !groundedPropositions.has(JSON.stringify([row.propositionKey, row.contextKey])),
      ),
    );
    const picked: Row[] = [];
    for (const candidate of budget.modelOnlyMissingAspect ? candidates.slice(0, 1) : candidates) {
      if (picked.length >= budget.modelPerAspect) break;
      if (!selected.has(candidate) && modelCount >= budget.modelTotal) continue;
      picked.push(candidate);
      if (!selected.has(candidate)) {
        selected.add(candidate);
        modelCount++;
      }
    }
    aspectRows.set(aspect, [...(aspectRows.get(aspect) ?? []), ...picked]);
  }
  // Identification and attribution records do not consume an aspect slot.
  for (const row of rows) if (row.grounded && !row.aspects.size) selected.add(row);
  return { selected: rows.filter((row) => selected.has(row)), aspectRows };
}

function distributeProjection(selected: Row[], aspectRows: Map<UnderstandingAspect, Row[]>) {
  const projected = new Map<UnderstandingAspect, Row[]>(understandingAspects.map((aspect) => [aspect, []]));
  const eligible = (row: Row) => understandingAspects.filter((aspect) => aspectRows.get(aspect)?.includes(row));
  for (const aspect of understandingAspects) {
    const references = aspectRows.get(aspect) ?? [];
    for (const row of references) {
      // Equal wording with different actors, negation, or conditions is a meaningful
      // contrast, not a duplicate that can be moved to another category.
      if (
        references.some(
          (other) =>
            other !== row && other.propositionKey === row.propositionKey && other.contextKey !== row.contextKey,
        )
      )
        projected.get(aspect)?.push(row);
    }
  }
  // Assign each retained claim to one category first. This keeps every claim visible while
  // avoiding identical prose in several cards when another claim can cover those cards.
  for (const row of [...selected].sort(
    (a, b) => eligible(a).length - eligible(b).length || a.sourceIndex - b.sourceIndex,
  )) {
    if (understandingAspects.some((aspect) => projected.get(aspect)?.includes(row))) continue;
    const choices = eligible(row);
    if (!choices.length) continue;
    const primaryAspect = stableKeyUnderstandingAspect(row.assertion.attributeStableKey);
    const primary = choices.sort(
      (a, b) =>
        Number(b === primaryAspect) - Number(a === primaryAspect) ||
        (projected.get(a)?.length ?? 0) - (projected.get(b)?.length ?? 0) ||
        (aspectRows.get(a)?.length ?? 0) - (aspectRows.get(b)?.length ?? 0) ||
        understandingAspects.indexOf(a) - understandingAspects.indexOf(b),
    )[0];
    projected.get(primary)?.push(row);
  }
  // A genuinely shared claim is still shown in another category if no distinct claim exists.
  for (const aspect of understandingAspects) {
    if (projected.get(aspect)?.length) continue;
    const fallback = aspectRows.get(aspect)?.[0];
    if (fallback) projected.set(aspect, [fallback]);
  }
  return projected;
}

export function normalizeUnderstanding(
  audit: GroundedUnderstandingAudit,
  verified: Verified[],
  completionAttempted: boolean,
  budget: UnderstandingBudget = UNDERSTANDING_PROVENANCE_BUDGET,
): NormalizedUnderstanding {
  if (verified.length !== audit.assertions.length) throw new Error("UNDERSTANDING_PROOF_ALIGNMENT");
  const rows = audit.assertions.flatMap((assertion, index) => {
    const row = rowFor(audit, assertion, verified[index], index);
    return row ? [row] : [];
  });
  splitSupportedSentences(rows, !budget.modelOnlyMissingAspect);
  const { selected, aspectRows } = selectByBudget(deduplicate(rows), budget);
  const projectedRows = distributeProjection(selected, aspectRows);
  const next = structuredClone(audit);
  next.assertions = selected.map((row) => row.assertion);
  const canonicalIndexes = new Map(selected.map((row, index) => [row, index]));
  for (const aspect of understandingAspects) {
    const assessment = next.aspectAssessments[aspect];
    const references = projectedRows.get(aspect) ?? [];
    const max = aspect === "narrativeRole" || aspect === "moralityOrientation" ? 200 : 500;
    const summary = references.map((row) => {
      const value = row.grounded
        ? row.assertion.valueText.trim()
        : row.assertion.valueText.trim().replace(/^未照合(?:（モデル知識）[:：]|のモデル知識では[、,])\s*/u, "");
      return (row.grounded ? value : `未照合（モデル知識）: ${value}`).slice(0, max);
    });
    next.summary[aspect] = [...new Set(summary)];
    assessment.summaryIndexes = next.summary[aspect].map((_, index) => index);
    assessment.assertionIndexes = references.map((row) => canonicalIndexes.get(row) as number);
    assessment.kind = references.length ? "concrete" : "unknown";
    assessment.reason = references.length
      ? references.every((row) => !row.grounded)
        ? "未照合のモデル知識に基づく人物描写です。"
        : "根拠検証後に保持された人物描写から要約を構成しました。"
      : "対象・根拠の検証後に採用できる人物描写が残りませんでした。";
    if (!references.length && !next.uncertainties.some((item) => item.topic === aspect))
      next.uncertainties.push({ topic: aspect, reason: assessment.reason });
  }
  next.sourceAssessment.modelKnowledgeUsed = selected.some((row) => !row.grounded);
  if (next.sourceAssessment.modelKnowledgeUsed)
    next.sourceAssessment.limitations = [
      ...new Set([
        ...next.sourceAssessment.limitations,
        "未照合のモデル知識を含みます。人物の確認済み事実ではありません。",
      ]),
    ].slice(-50);
  next.uncertainties = next.uncertainties.slice(-50);
  const parsed = understandingAuditSchema.parse(next);
  return {
    ...parsed,
    informationQuality: assessUnderstandingInformation(parsed, completionAttempted),
    canonicalSourceIndexes: selected.map((row) => row.sourceIndex),
    canonicalProofs: selected.map((row) => row.verified),
  };
}
