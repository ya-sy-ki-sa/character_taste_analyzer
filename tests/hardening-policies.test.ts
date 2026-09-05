import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceReference } from "../shared/contracts/evidence";
import type { GeneratedCharacterCandidate } from "../shared/contracts/generation";
import { jsonPointerExists, validateGenerationCoverage } from "../worker/features/generation/validation";
import { isRetryableFailure, jobClaimDisposition } from "../worker/features/jobs/policy";
import { profileConditionJson } from "../worker/features/profile/context";
import { workflowInstanceIdForEvent } from "../worker/platform/outbox/protocol";
import {
  type ProvenanceSource,
  ProvenanceVerificationError,
  verifyEvidenceReference,
} from "../worker/platform/provenance/verifier";
import { nextQuotaSlot, quotaLimit } from "../worker/platform/quota/policy";

const source: ProvenanceSource = {
  sourceId: "source-1",
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
      sourceId: "source-1",
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
      sourceId: "source-customization",
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
      sourceId: "source-customization",
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
      sourceId: "web",
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
    expect(byRef.sourceId).toBe(source.sourceId);

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
      sourceId: "canonical-web",
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
      sourceId: "canonical-web",
      evidenceOrigin: "source",
      verificationStatus: "source_attributed",
    });
  });

  it("matches the observed malformed percent-encoded Wikipedia URL to its allowed source", async () => {
    const allowedUrl =
      "https://ja.wikipedia.org/wiki/%E5%8A%87%E5%A0%B4%E7%89%88BLEACH_The_DiamondDust_Rebellion_%E3%82%82%E3%81%86%E4%B8%80%E3%81%A4%E3%81%AE%E6%B0%B7%E8%BC%AA%E4%B8%B8";
    const malformedUrl =
      "https://ja.wikipedia.org/wiki/%E5%8A%87%E5%A0%B版BLEACH_The_DiamondDust_Rebellion_%E3%82%82%E3%81%86%E4%B8%80%E3%81%A4%E3%81%AE%E6%B0%B7%E8%BC%AA%E4%B8%B8";
    const webSource: ProvenanceSource = {
      ...source,
      sourceId: "bleach-wikipedia",
      inputPointer: null,
      url: allowedUrl,
      origin: "source",
    };

    const result = await verifyEvidenceReference(
      evidence({ sourceRef: null, sourceUrl: malformedUrl, inputPointer: null, quote: null }),
      [webSource],
      new Set([allowedUrl]),
    );

    expect(result).toMatchObject({
      sourceId: "bleach-wikipedia",
      evidenceOrigin: "source",
      verificationStatus: "source_attributed",
    });
  });

  it("repairs multiple malformed UTF-8 percent encodings in the same observed Wikipedia URL", async () => {
    const allowedUrl =
      "https://ja.wikipedia.org/wiki/%E5%8A%87%E5%A0%B4%E7%89%88BLEACH_The_DiamondDust_Rebellion_%E3%82%82%E3%81%86%E4%B8%80%E3%81%A4%E3%81%AE%E6%B0%B7%E8%BC%AA%E4%B8%B8";
    const malformedUrl =
      "https://ja.wikipedia.org/wiki/%E5%8A%87%E5%A0%B版BLEACH_The_DiamondDust_Rebellion_%E3%82%82%E3%81%86%E4%B8%80%E3%81%A4%E3%81%AE%E6%B0%B7%E8%BC輪丸";
    const webSource: ProvenanceSource = {
      ...source,
      sourceId: "bleach-wikipedia-multiple-repairs",
      inputPointer: null,
      url: allowedUrl,
      origin: "source",
    };

    const result = await verifyEvidenceReference(
      evidence({ sourceRef: null, sourceUrl: malformedUrl, inputPointer: null, quote: null }),
      [webSource],
      new Set([allowedUrl]),
    );

    expect(result).toMatchObject({
      sourceId: "bleach-wikipedia-multiple-repairs",
      evidenceOrigin: "source",
      verificationStatus: "source_attributed",
    });
  });

  it("repairs a duplicated incomplete UTF-8 prefix before the complete encoded character", async () => {
    const suffix = "character-profile-".repeat(4);
    const allowedUrl = `https://allowed.example/wiki/%E8%BC%AA-${suffix}`;
    const malformedUrl = `https://allowed.example/wiki/%E8%BC輪-${suffix}`;
    const webSource: ProvenanceSource = {
      ...source,
      sourceId: "utf8-prefix-repair",
      inputPointer: null,
      url: allowedUrl,
      origin: "source",
    };

    const result = await verifyEvidenceReference(
      evidence({ sourceRef: null, sourceUrl: malformedUrl, inputPointer: null, quote: null }),
      [webSource],
      new Set([allowedUrl]),
    );

    expect(result.sourceId).toBe("utf8-prefix-repair");
  });

  it("rejects percent-encoding corruption that requires more than three repairs", async () => {
    const suffix = "x".repeat(100);
    const allowedUrl = `https://allowed.example/wiki/%AA%AA%AA%AA-${suffix}`;
    const malformedUrl = `https://allowed.example/wiki/%A%A%A%A-${suffix}`;

    await expect(
      verifyEvidenceReference(
        evidence({ sourceRef: null, sourceUrl: malformedUrl, inputPointer: null, quote: null }),
        [],
        new Set([allowedUrl]),
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_CITATION_NOT_ALLOWED" });
  });

  it("rejects malformed percent encoding when repairs match more than one allowed URL", async () => {
    const suffix = "x".repeat(100);
    const malformedUrl = `https://allowed.example/wiki/%A-${suffix}`;

    await expect(
      verifyEvidenceReference(
        evidence({ sourceRef: null, sourceUrl: malformedUrl, inputPointer: null, quote: null }),
        [],
        new Set([`https://allowed.example/wiki/%AA-${suffix}`, `https://allowed.example/wiki/%AB-${suffix}`]),
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_CITATION_NOT_ALLOWED" });
  });

  it.each([
    ["deletion", "characterprofile-"],
    ["insertion", "character--profile-"],
    ["substitution", "character-profila-"],
  ])("accepts a one-character %s in a sufficiently long path", async (_variation, changedSegment) => {
    const repeatedPath = "character-profile-".repeat(4);
    const allowedUrl = `https://allowed.example/articles/${repeatedPath}`;
    const evidenceUrl = allowedUrl.replace("character-profile-", changedSegment);
    const webSource: ProvenanceSource = {
      ...source,
      sourceId: "approximate-path",
      inputPointer: null,
      url: allowedUrl,
      origin: "source",
    };

    const result = await verifyEvidenceReference(
      evidence({ sourceRef: null, sourceUrl: evidenceUrl, inputPointer: null, quote: null }),
      [webSource],
      new Set([allowedUrl]),
    );

    expect(result.sourceId).toBe("approximate-path");
  });

  it("accepts a one-character difference in a sufficiently long query", async () => {
    const path = "character-profile-".repeat(4);
    const allowedUrl = `https://allowed.example/articles/${path}?chapter=1234567890`;
    const evidenceUrl = allowedUrl.replace("1234567890", "1234567891");
    const webSource: ProvenanceSource = {
      ...source,
      sourceId: "approximate-query",
      inputPointer: null,
      url: allowedUrl,
      origin: "source",
    };

    const result = await verifyEvidenceReference(
      evidence({ sourceRef: null, sourceUrl: evidenceUrl, inputPointer: null, quote: null }),
      [webSource],
      new Set([allowedUrl]),
    );

    expect(result.sourceId).toBe("approximate-query");
  });

  it.each([
    [
      "a different origin",
      `https://other.example/articles/${"a".repeat(100)}`,
      `https://allowed.example/articles/${"a".repeat(100)}`,
    ],
    [
      "a difference beyond the cap",
      `https://allowed.example/articles/${"b".repeat(6)}${"a".repeat(294)}`,
      `https://allowed.example/articles/${"a".repeat(300)}`,
    ],
    ["a one-character difference in a short URL", "https://allowed.example/a", "https://allowed.example/b"],
  ])("rejects %s", async (_case, evidenceUrl, allowedUrl) => {
    await expect(
      verifyEvidenceReference(
        evidence({ sourceRef: null, sourceUrl: evidenceUrl, inputPointer: null, quote: null }),
        [],
        new Set([allowedUrl]),
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_CITATION_NOT_ALLOWED" });
  });

  it("rejects an approximate URL when two allowed sources are equally close", async () => {
    const prefix = `https://allowed.example/articles/${"a".repeat(60)}`;
    const evidenceUrl = `${prefix}x`;

    await expect(
      verifyEvidenceReference(
        evidence({ sourceRef: null, sourceUrl: evidenceUrl, inputPointer: null, quote: null }),
        [],
        new Set([`${prefix}y`, `${prefix}z`]),
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_CITATION_NOT_ALLOWED" });
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
        outputPointers: ["/personality"],
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
          outputPointers: ["/personality"],
        },
      ],
    } as GeneratedCharacterCandidate;
    const violations = validateGenerationCoverage(brief, invalid);
    expect(violations).toEqual(
      expect.arrayContaining([
        "treatment不一致: required",
        "必須の好み未達: required",
        "Pointer欠落: required",
        "未知のcoverage: unknown",
        "避ける好み違反: prohibited",
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
        JSON.stringify({
          schemaVersion: "2",
          conditions: ["夜"],
          entryScope: "全体",
        }),
      ),
    ).toBe('{"conditions":["夜"],"entryScope":"全体","schemaVersion":"2"}');
  });

  it("rejects malformed and removed legacy contexts", () => {
    expect(profileConditionJson("broken")).toBe("{}");
    expect(profileConditionJson('{"schemaVersion":"1","scope":"限定場面"}')).toBe("{}");
  });
});
