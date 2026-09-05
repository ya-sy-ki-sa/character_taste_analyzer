import { describe, expect, it } from "vitest";
import { summarizeUnderstandingEvidence } from "../shared/understanding-evidence";

describe("understanding evidence counts", () => {
  it("counts unique evidence with verification status before origin, without interpreting confidence", () => {
    const proof = (id: string, verificationStatus: string, evidenceOrigin?: string) => ({
      id,
      verificationStatus,
      evidenceOrigin,
    });
    const source = proof("source", "verified_quote", "source");
    const result = summarizeUnderstandingEvidence([
      {
        status: "confirmed",
        evidence: [
          source,
          source,
          proof("input", "verified_quote", "user_input"),
          proof("review", "verified_quote", "review"),
        ],
      },
      {
        status: "proposed",
        evidence: [
          source,
          proof("attributed", "source_attributed", "source"),
          proof("model", "model_knowledge", "user_input"),
          proof("invalid", "invalid", "review"),
        ],
      },
      {
        status: "corrected",
        evidence: [
          proof("unknown", "unknown", "source"),
          proof("inconsistent", "verified_quote", "model_knowledge"),
          proof("missing", "verified_quote"),
        ],
      },
      { status: "confirmed", evidence: [] },
      { status: "rejected", evidence: [proof("rejected", "verified_quote", "source")] },
      { status: "superseded", evidence: [] },
    ]);
    expect(result).toEqual({
      assertionCount: 4,
      assertionsWithoutEvidence: 1,
      counts: {
        sourceQuote: 1,
        userInputQuote: 1,
        userConfirmation: 1,
        sourceAttributed: 1,
        modelKnowledge: 1,
        invalid: 1,
        unclassified: 3,
      },
    });
    expect(summarizeUnderstandingEvidence([])).toEqual({
      assertionCount: 0,
      assertionsWithoutEvidence: 0,
      counts: {
        sourceQuote: 0,
        userInputQuote: 0,
        userConfirmation: 0,
        sourceAttributed: 0,
        modelKnowledge: 0,
        invalid: 0,
        unclassified: 0,
      },
    });
  });
});
