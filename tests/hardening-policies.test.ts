import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceReference, GeneratedCharacterCandidate } from "../shared/schemas";
import { jsonPointerExists, validateGenerationCoverage } from "../worker/services/generation-validation";
import { isRetryableFailure, jobClaimDisposition } from "../worker/services/job-policy";
import { workflowInstanceIdForEvent } from "../worker/services/orchestration";
import { profileConditionJson } from "../worker/services/profile-context";
import {
  ProvenanceVerificationError,
  verifyEvidenceReference,
  type ProvenanceSource,
} from "../worker/services/provenance-verifier";
import { nextQuotaSlot, quotaLimit } from "../worker/services/quota-policy";

const source: ProvenanceSource = {
  fragmentId: "fragment-1",
  text: "彼女は最後まで自分の規範を曲げない。",
  inputPointer: "/referenceMaterial",
  url: null,
  origin: "user_input",
};

function evidence(overrides: Partial<EvidenceReference> = {}): EvidenceReference {
  return {
    sourceRef: "input:referenceMaterial",
    sourceUrl: null,
    inputPointer: "/referenceMaterial",
    quote: "自分の規範を曲げない",
    inferenceType: "direct",
    ...overrides,
  };
}

describe("provenance verifier", () => {
  it("computes offsets and hash from an exact input quote", async () => {
    const result = await verifyEvidenceReference(evidence(), [source], new Set());
    expect(result).toMatchObject({
      sourceFragmentId: "fragment-1",
      evidenceOrigin: "user_input",
      quoteStart: 7,
      quoteEnd: 17,
      verificationStatus: "verified_quote",
      inputPointer: "/referenceMaterial",
    });
    expect(result.quoteHash).toBe(createHash("sha256").update("自分の規範を曲げない").digest("hex"));
  });

  it("canonicalizes a prompt heading accidentally included in the input pointer", async () => {
    const customizationSource: ProvenanceSource = {
      fragmentId: "fragment-customization",
      text: "犯罪組織「暁」に所属しているナルト",
      inputPointer: "/customizationDescription",
      url: null,
      origin: "user_input",
    };
    const result = await verifyEvidenceReference(
      evidence({
        sourceRef: "input:登録情報/customizationDescription",
        inputPointer: "/登録情報/customizationDescription",
        quote: "犯罪組織「暁」に所属しているナルト",
      }),
      [customizationSource],
      new Set(),
    );
    expect(result).toMatchObject({
      sourceFragmentId: "fragment-customization",
      verificationStatus: "verified_quote",
      inputPointer: "/customizationDescription",
      quoteStart: 0,
    });
  });

  it("accepts only annotated external URLs", async () => {
    const error = await verifyEvidenceReference(
      evidence({
        sourceRef: null,
        sourceUrl: "https://invalid.example",
        inputPointer: null,
      }),
      [],
      new Set(["https://allowed.example"]),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProvenanceVerificationError);
    expect(error).toMatchObject({
      code: "EXTERNAL_CITATION_NOT_ALLOWED",
      safeDetail: expect.stringContaining("参照URL: https://invalid.example"),
    });
    expect((error as ProvenanceVerificationError).safeDetail).toContain(
      "このエラー自体はOpenAIの拒否やセンシティブ判定を示しません",
    );
  });

  it("classifies mismatched direct quotes as invalid", async () => {
    const result = await verifyEvidenceReference(evidence({ quote: "存在しない引用" }), [source], new Set());
    expect(result.verificationStatus).toBe("invalid");
    expect(result.quoteStart).toBeNull();
  });

  it("classifies attributed sources and model knowledge separately", async () => {
    const attributed = await verifyEvidenceReference(evidence({ quote: null }), [source], new Set());
    expect(attributed.verificationStatus).toBe("source_attributed");

    const knowledge = await verifyEvidenceReference(
      evidence({
        sourceRef: "model_knowledge",
        inputPointer: null,
        quote: null,
        inferenceType: "inferred",
      }),
      [],
      new Set(),
    );
    expect(knowledge.verificationStatus).toBe("model_knowledge");

    const japaneseKnowledge = await verifyEvidenceReference(
      evidence({ sourceRef: "モデル知識", inputPointer: null, quote: null }),
      [],
      new Set(),
    );
    expect(japaneseKnowledge.verificationStatus).toBe("model_knowledge");
  });

  it("resolves allowed URL, sourceRef and quote-only references", async () => {
    const webSource: ProvenanceSource = {
      ...source,
      fragmentId: "web",
      inputPointer: null,
      url: "https://allowed.example",
      origin: "source",
    };
    const byUrl = await verifyEvidenceReference(
      evidence({
        sourceRef: null,
        sourceUrl: webSource.url,
        inputPointer: null,
      }),
      [webSource],
      new Set([webSource.url as string]),
    );
    expect(byUrl.evidenceOrigin).toBe("source");

    const byRef = await verifyEvidenceReference(
      evidence({ sourceRef: "input:/referenceMaterial", inputPointer: null }),
      [source],
      new Set(),
    );
    expect(byRef.sourceFragmentId).toBe(source.fragmentId);

    const byQuote = await verifyEvidenceReference(
      evidence({ sourceRef: null, inputPointer: null }),
      [source],
      new Set(),
    );
    expect(byQuote.verificationStatus).toBe("verified_quote");
  });

  it("accepts canonical URL variants without weakening the source allowlist", async () => {
    const webSource: ProvenanceSource = {
      ...source,
      fragmentId: "canonical-web",
      inputPointer: null,
      url: "https://allowed.example/articles/hero/?utm_source=chatgpt.com#profile",
      origin: "source",
    };
    const result = await verifyEvidenceReference(
      evidence({
        sourceRef: null,
        sourceUrl: "https://allowed.example/articles/hero",
        inputPointer: null,
        quote: null,
      }),
      [webSource],
      new Set([webSource.url as string]),
    );
    expect(result).toMatchObject({
      sourceFragmentId: "canonical-web",
      evidenceOrigin: "source",
      verificationStatus: "source_attributed",
    });
  });

  it("keeps a non-direct mismatched quote source-attributed", async () => {
    const result = await verifyEvidenceReference(
      evidence({ quote: "一致しない要約", inferenceType: "paraphrase" }),
      [source],
      new Set(),
    );
    expect(result.verificationStatus).toBe("source_attributed");
  });

  it("keeps an unresolvable direct reference invalid", async () => {
    const result = await verifyEvidenceReference(
      evidence({ sourceRef: "unknown", inputPointer: "/unknown", quote: null }),
      [],
      new Set(),
    );
    expect(result.verificationStatus).toBe("invalid");
  });
});

describe("generation coverage validator", () => {
  const brief = {
    preferenceSelections: [
      { profileSnapshotItemId: "required", treatment: "required" as const },
      { profileSnapshotItemId: "prohibited", treatment: "prohibit" as const },
    ],
  };
  const baseCandidate = {
    personality: { traits: [{ label: "一貫性" }] },
    uncertainties: [],
    briefCoverage: [
      {
        profileSnapshotItemId: "required",
        treatment: "required",
        status: "satisfied",
        outputPointers: ["/personality/traits/0/label"],
      },
      {
        profileSnapshotItemId: "prohibited",
        treatment: "prohibit",
        status: "satisfied",
        outputPointers: ["/uncertainties"],
      },
    ],
  } as unknown as GeneratedCharacterCandidate;

  it("accepts exactly-once coverage with valid RFC 6901 pointers", () => {
    expect(validateGenerationCoverage(brief, baseCandidate)).toEqual([]);
    expect(jsonPointerExists({ "a/b": { "~key": 1 } }, "/a~1b/~0key")).toBe(true);
    expect(jsonPointerExists(baseCandidate, "")).toBe(true);
  });

  it("detects duplicates, omissions, unknown ids, treatments, pointers and semantic status", () => {
    const invalid = {
      ...baseCandidate,
      briefCoverage: [
        {
          profileSnapshotItemId: "required",
          treatment: "include",
          status: "omitted",
          outputPointers: ["personality", "/personality/traits/9", "/missing"],
        },
        {
          profileSnapshotItemId: "required",
          treatment: "required",
          status: "satisfied",
          outputPointers: [],
        },
        {
          profileSnapshotItemId: "unknown",
          treatment: "include",
          status: "satisfied",
          outputPointers: ["/personality"],
        },
        {
          profileSnapshotItemId: "prohibited",
          treatment: "prohibit",
          status: "violated",
          outputPointers: ["/uncertainties"],
        },
      ],
    } as GeneratedCharacterCandidate;
    const violations = validateGenerationCoverage(brief, invalid);
    expect(violations).toEqual(
      expect.arrayContaining([
        "treatment不一致: required",
        "必須嗜好未達: required",
        "Pointer欠落: required",
        "未知のcoverage: unknown",
        "禁止嗜好違反: prohibited",
        "coverage exactly-once違反: required:2",
      ]),
    );
    expect(violations.filter((item) => item.startsWith("Pointer不正"))).toHaveLength(3);
    expect(jsonPointerExists(null, "/x")).toBe(false);
    expect(jsonPointerExists([], "/x")).toBe(false);
  });

  it("reports completely omitted selections", () => {
    expect(
      validateGenerationCoverage(brief, {
        ...baseCandidate,
        briefCoverage: [],
      }),
    ).toEqual(["coverage exactly-once違反: required:0", "coverage exactly-once違反: prohibited:0"]);
  });
});

describe("job and quota policies", () => {
  it("uses the outbox event as the workflow execution identity", () => {
    expect(workflowInstanceIdForEvent("event-1", "analysis.start")).toBe("analysis-event-1");
    expect(workflowInstanceIdForEvent("event-1", "analysis.start")).toBe(
      workflowInstanceIdForEvent("event-1", "analysis.start"),
    );
    expect(workflowInstanceIdForEvent("event-2", "analysis.start")).not.toBe(
      workflowInstanceIdForEvent("event-1", "analysis.start"),
    );
  });

  it.each(["succeeded", "waiting_for_user", "cancelled", "superseded"])(
    "does not reclaim a terminal %s job",
    (status) => {
      expect(
        jobClaimDisposition({
          status,
          storedGeneration: 1,
          requestedGeneration: 1,
          targetType: "entry",
          activeRevisionNumber: 1,
        }),
      ).toBe("already_finished");
    },
  );

  it("fences old generations and non-claimable states", () => {
    expect(
      jobClaimDisposition({
        status: "queued",
        storedGeneration: 2,
        requestedGeneration: 1,
        targetType: "entry",
        activeRevisionNumber: 2,
      }),
    ).toBe("superseded");
    expect(
      jobClaimDisposition({
        status: "queued",
        storedGeneration: 1,
        requestedGeneration: 1,
        targetType: "entry",
        activeRevisionNumber: 2,
      }),
    ).toBe("superseded");
    expect(
      jobClaimDisposition({
        status: "running",
        storedGeneration: 1,
        requestedGeneration: 1,
        targetType: "user",
        activeRevisionNumber: null,
      }),
    ).toBe("not_claimable");
    expect(
      jobClaimDisposition({
        status: "retrying",
        storedGeneration: 1,
        requestedGeneration: 1,
        targetType: "user",
        activeRevisionNumber: null,
      }),
    ).toBe("claimable");
    expect(
      jobClaimDisposition({
        status: "failed",
        storedGeneration: 1,
        requestedGeneration: 1,
        targetType: "entry",
        activeRevisionNumber: null,
      }),
    ).toBe("claimable");
  });

  it("distinguishes retryable provider and storage failures", () => {
    expect(isRetryableFailure({ retryable: true })).toBe(true);
    expect(isRetryableFailure({ retryable: false })).toBe(false);
    expect(isRetryableFailure(new Error("D1_BATCH_FAILED"))).toBe(true);
    expect(isRetryableFailure(new Error("CONFIGURATION_ERROR"))).toBe(false);
    expect(isRetryableFailure("D1_BATCH_FAILED")).toBe(false);
  });

  it("reserves bounded capability slots without charging overflow", () => {
    expect(quotaLimit("analysis", { analysis: "40" })).toBe(40);
    expect(quotaLimit("generation", { generation: "12" })).toBe(12);
    expect(quotaLimit("export", { export: undefined })).toBe(3);
    expect(nextQuotaSlot(0, 1)).toBe(1);
    expect(nextQuotaSlot(1, 1)).toBeNull();
    expect(nextQuotaSlot(-3, 2)).toBe(1);
    expect(nextQuotaSlot(1.9, 3)).toBe(2);
  });
});

describe("profile context preservation", () => {
  it("canonicalizes and preserves a version 2 context", () => {
    expect(
      profileConditionJson(
        "legacy",
        JSON.stringify({
          schemaVersion: "2",
          conditions: ["夜"],
          entryScope: "全体",
        }),
      ),
    ).toBe('{"conditions":["夜"],"entryScope":"全体","schemaVersion":"2"}');
  });

  it("falls back safely for malformed and legacy contexts", () => {
    expect(profileConditionJson(" 限定場面 ", "broken")).toBe('{"schemaVersion":"1","scope":"限定場面"}');
    expect(profileConditionJson("キャラクター全体", '{"schemaVersion":"1"}')).toBe("{}");
  });
});
