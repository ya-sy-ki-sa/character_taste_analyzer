import { describe, expect, it } from "vitest";
import { z } from "zod";
import { citationAwareProvider } from "../worker/features/analysis/citations";
import {
  type LlmProvider,
  LlmProviderError,
  type LlmRunMetadata,
  type StructuredLlmRequest,
} from "../worker/llm/types";
import { CITATION_POLICY_VERSION, CitationRegistry } from "../worker/platform/provenance/registry";
import { type ProvenanceSource, verifyEvidenceReference } from "../worker/platform/provenance/verifier";
import failures from "./fixtures/citation-failures.json";

const evidence = {
  sourceRef: null,
  sourceUrl: null,
  inputPointer: null,
  quote: null,
  inferenceType: "paraphrase" as const,
};
const source: ProvenanceSource = {
  sourceId: "page",
  text: "verified text",
  url: "https://example.com/page",
  inputPointer: null,
  origin: "source",
};
const metadata: LlmRunMetadata = {
  provider: "replay",
  transport: "replay",
  adapterVersion: "test",
  requestedModel: "test",
  resolvedModel: "test",
  latencyMs: 1,
  dataRetentionMode: "no_retention",
};

describe("external citation registry", () => {
  it.each(failures)(
    "invalidates $caseId without repairing or falling back to matching prose",
    async ({ sourceUrl, allowedUrls }) => {
      const result = await verifyEvidenceReference(
        { ...evidence, sourceUrl, quote: source.text },
        [source],
        new Set(allowedUrls),
      );
      expect(result).toMatchObject({
        sourceId: null,
        evidenceOrigin: "source",
        verificationStatus: "invalid",
        issueReason: "url_not_allowed",
      });
    },
  );

  it("uses stable IDs across additions, canonical variants, and separate registry instances", async () => {
    const registry = new CitationRegistry();
    await registry.add([{ url: `${source.url}?utm_source=test#fragment`, title: "Original title" }]);
    const ref = registry.entries()[0].sourceRef;
    await registry.add([
      { url: "https://example.com/other", title: "Other" },
      { url: source.url as string, title: "Same" },
    ]);
    expect(registry.entries()).toHaveLength(2);
    expect(ref).toMatch(/^external:[a-f0-9]{64}$/);
    expect(registry.resolve(ref)?.title).toBe("Original title");
    const resolved = await verifyEvidenceReference(
      { ...evidence, sourceRef: ref, quote: source.text, inferenceType: "direct" },
      [source],
      new Set([source.url as string]),
    );
    expect(resolved).toMatchObject({
      sourceId: source.sourceId,
      verificationStatus: "verified_quote",
      resolutionMethod: "external_id",
    });
  });

  it("rejects unknown IDs, conflicting locators, and IDs from a different allowlist", async () => {
    const registry = new CitationRegistry();
    await registry.add([{ url: source.url as string, title: "Page" }]);
    const sourceRef = registry.entries()[0].sourceRef;
    for (const ref of [
      { ...evidence, sourceRef: "external:unknown", quote: source.text },
      { ...evidence, sourceRef, sourceUrl: "https://example.com/other" },
      { ...evidence, sourceRef, inputPointer: "/characterName" },
    ]) {
      expect(await verifyEvidenceReference(ref, [source], new Set([source.url as string]), registry)).toMatchObject({
        sourceId: null,
        verificationStatus: "invalid",
      });
    }
    expect(await verifyEvidenceReference({ ...evidence, sourceRef }, [source], new Set(), registry)).toMatchObject({
      issueReason: "unknown_source_ref",
    });
    expect(
      await verifyEvidenceReference({ ...evidence, sourceRef }, [], new Set([source.url as string]), registry),
    ).toMatchObject({ issueReason: "source_unavailable" });
    expect(
      await verifyEvidenceReference(
        { ...evidence, sourceRef, sourceUrl: source.url },
        [source],
        new Set([source.url as string]),
        registry,
      ),
    ).toMatchObject({ verificationStatus: "source_attributed" });
  });

  it("does not register invalid URLs or non-HTTP sources", async () => {
    const registry = new CitationRegistry();
    await registry.add(["broken", "javascript:alert(1)"].map((url) => ({ url, title: url })));
    expect(registry.entries()).toEqual([]);
  });
});

describe("citation-aware LLM calls", () => {
  const schema = z.object({ value: z.string() });
  const request: StructuredLlmRequest<z.infer<typeof schema>> = {
    operation: "character_understanding",
    schemaName: "test",
    schemaVersion: "1",
    schema,
    jsonSchema: {},
    messages: [],
    maxOutputTokens: 100,
    temperature: 0,
    idempotencyKey: "test",
    fakeFactory: () => ({ value: "https://invented.example" }),
  };

  it("passes collected IDs initially and carries every attempt citation into audits without extra calls", async () => {
    const requests: StructuredLlmRequest<unknown>[] = [];
    const provider: LlmProvider = {
      providerId: "replay",
      async generateStructured(req) {
        requests.push(req);
        const value = req.fakeFactory();
        return {
          value,
          metadata: { ...metadata, citations: [{ url: "https://example.com/final", title: "Final" }] },
          attempts: [
            {
              output: value,
              metadata: { ...metadata, citations: [{ url: "https://example.com/attempt", title: "Attempt" }] },
            },
            { output: value, metadata: { ...metadata, citations: [] } },
          ],
        };
      },
    };
    const wrapped = await citationAwareProvider(provider, [{ url: source.url as string, title: "Page" }]);
    const first = await wrapped.generateStructured(request);
    await wrapped.generateStructured({ ...request, operation: "understanding_audit" });
    await wrapped.generateStructured({ ...request, idempotencyKey: "completion" });
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[0].messages)).toContain("external:");
    const audit = JSON.stringify(requests[1].messages);
    expect(audit).toContain("https://example.com/attempt");
    expect(audit).toContain("https://example.com/final");
    expect(audit).not.toContain("https://invented.example");
    expect(first.metadata.citations).toHaveLength(2);
    expect(first.attempts?.[0].metadata.effectiveSettings).toMatchObject({
      citationPolicyVersion: CITATION_POLICY_VERSION,
    });
  });

  it("preserves provider failures and attempt diagnostics", async () => {
    const failure = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    failure.attempts = [{ output: {}, metadata: { ...metadata } }];
    failure.attemptMetadata = { ...metadata };
    const wrapped = await citationAwareProvider(
      {
        providerId: "replay",
        generateStructured: async () => {
          throw failure;
        },
      },
      [],
    );
    await expect(wrapped.generateStructured(request)).rejects.toBe(failure);
    expect(failure.attemptMetadata.effectiveSettings).toMatchObject({ citationPolicyVersion: CITATION_POLICY_VERSION });
  });
});
