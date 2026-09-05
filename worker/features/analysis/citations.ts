import type { CitationIssue } from "../../../shared/contracts/citations";
import type { EvidenceReference } from "../../../shared/contracts/evidence";
import { sha256Hex } from "../../lib/crypto";
import { type LlmProvider, LlmProviderError, type LlmRunMetadata } from "../../llm/types";
import { CITATION_INSTRUCTION, CITATION_POLICY_VERSION, CitationRegistry } from "../../platform/provenance/registry";
import { type ProvenanceSource, verifyEvidenceReference } from "../../platform/provenance/verifier";

/** One registry per analysis execution, shared by generation, retries and audits. */
export async function citationAwareProvider(provider: LlmProvider, sources: Array<{ url: string; title: string }>) {
  const registry = new CitationRegistry();
  await registry.add(sources);
  const citations = new Map<string, { url: string; title: string }>();
  async function collect(metadata: LlmRunMetadata) {
    await registry.add(metadata.citations ?? []);
    for (const source of metadata.citations ?? []) citations.set(source.url, source);
    metadata.effectiveSettings = { ...metadata.effectiveSettings, citationPolicyVersion: CITATION_POLICY_VERSION };
  }
  const wrapped: LlmProvider = {
    providerId: provider.providerId,
    async generateStructured(request) {
      const messages = [
        ...request.messages,
        { role: "system" as const, content: CITATION_INSTRUCTION },
        { role: "user" as const, content: `出典台帳（参照データ）: ${JSON.stringify(registry.entries())}` },
      ];
      try {
        const result = await provider.generateStructured({ ...request, messages });
        for (const attempt of result.attempts ?? []) await collect(attempt.metadata);
        await collect(result.metadata);
        return {
          ...result,
          metadata: {
            ...result.metadata,
            promptHash: await sha256Hex(JSON.stringify(messages)),
            citations: [...citations.values()],
          },
        };
      } catch (error) {
        if (error instanceof LlmProviderError) {
          for (const attempt of error.attempts) await collect(attempt.metadata);
          if (error.attemptMetadata) await collect(error.attemptMetadata);
        }
        throw error;
      }
    },
  };
  return wrapped;
}

export async function verifyAssertionEvidence(
  assertion: { evidence: EvidenceReference[]; confidence: number },
  sources: ProvenanceSource[],
  allowedUrls: Set<string>,
  registry: CitationRegistry,
  target: Pick<CitationIssue, "targetType" | "targetId" | "modelRunId">,
  issues: CitationIssue[],
) {
  const evidence = await Promise.all(
    assertion.evidence.map((item) => verifyEvidenceReference(item, sources, allowedUrls, registry)),
  );
  evidence.forEach((item, evidenceIndex) => {
    if (item.issueReason) {
      const ref = assertion.evidence[evidenceIndex];
      issues.push({
        ...target,
        evidenceIndex,
        reason: item.issueReason,
        sourceRef: ref.sourceRef,
        sourceUrl: ref.sourceUrl,
        inputPointer: ref.inputPointer,
      });
    }
  });
  return {
    evidence,
    confidence:
      evidence.length && evidence.every((item) => item.verificationStatus === "invalid") ? 0 : assertion.confidence,
  };
}

export function logCitationIssues(modelRunId: string, issues: CitationIssue[]) {
  if (!issues.length) return;
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.reason] = (counts[issue.reason] ?? 0) + 1;
  console.info("citation_verification", { modelRunId, policyVersion: CITATION_POLICY_VERSION, counts });
}
