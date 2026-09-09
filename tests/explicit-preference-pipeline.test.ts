import { describe, expect, it } from "vitest";
import { generationRequestInputSchema } from "../shared/contracts/generation";
import { preferenceCandidateSchema } from "../shared/contracts/preference";
import { preferenceReviewMutationSchema } from "../shared/contracts/reviews";
import { groupProfileDimensions } from "../src/lib/profile-dimensions";
import { mutatePreferenceReview } from "../worker/features/entries/preference-review";
import { loadEntryReview } from "../worker/features/entries/review";
import { compileBrief } from "../worker/features/generation/brief";
import { createGenerationRequest } from "../worker/features/generation/request";
import { loadCurrentGraph } from "../worker/features/profile/graph";
import { loadProfileSnapshotItems } from "../worker/features/profile/snapshot";
import { PREFERENCE_PROMPT_VERSION, preferenceInstruction } from "../worker/llm/prompts/preference";
import fixtures from "./fixtures/explicit-preferences.json";
import semanticFixtures from "./fixtures/preference-semantics.json";

import { context, type Fixture, rebuild, scriptedCandidate, setup } from "./support/preference-pipeline";

describe("frozen explicit preferences", () => {
  // Unresolved preferences + value stance, known channel, and empty output cover distinct storage paths.
  // Other wording examples remain available for evaluation; scripted responses cannot judge their semantics.
  it.each(fixtures.filter((item) => ["B05", "A12", "B03"].includes(item.caseId)))(
    "preserves $caseId content, quotes and qualifications through the existing two calls",
    async (fixture) => {
      const result = await setup("standard", fixture);
      const { analysis, requests, db } = result;
      expect(analysis.assertions.map((item) => item.raw_label).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.rawLabel).sort(),
      );
      for (const expected of fixture.expectedAssertions) {
        const item = analysis.assertions.find((item) => item.raw_label === expected.rawLabel);
        if (!item) throw new Error("missing assertion");
        expect(item.response_channel).toBe(expected.responseChannel);
        expect(item.confidence).toBe(0.92);
        expect(item.evidence).toEqual([
          expect.objectContaining({ quote: expected.quote, verificationStatus: "verified_quote" }),
        ]);
        expect(
          JSON.parse(
            String(
              db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(item.id)
                ?.context_json,
            ),
          ).conditions,
        ).toEqual(expected.conditions);
      }
      const calls = requests.filter((item) => /^(dark_)?preference_(analysis|audit)$/.test(item.operation));
      expect(calls).toHaveLength(2);
      expect(
        calls.every((item) =>
          item.messages.some((message) => message.content.includes(preferenceInstruction("standard"))),
        ),
      ).toBe(true);
      expect(analysis.qualityContext).toMatchObject({
        preferenceAssertionCount: fixture.expectedAssertions.length,
        valueStanceAssertionCount: fixture.preference.dislikedReasons ? 1 : 0,
        unresolvedResponseChannelCount: fixture.expectedAssertions.filter((item) => item.responseChannel === null)
          .length,
      });
      const runs = db.database
        .prepare(
          "SELECT operation,prompt_version,schema_version FROM model_run_metadata WHERE operation LIKE 'preference_%'",
        )
        .all();
      expect(runs).toHaveLength(2);
      expect(
        runs.every(
          (item) =>
            String(item.prompt_version).endsWith(`/${PREFERENCE_PROMPT_VERSION}`) &&
            item.schema_version === (item.operation === "preference_audit" ? "1.0" : "3.0"),
        ),
      ).toBe(true);
      if (!fixture.expectedAssertions.length) {
        expect(analysis.summary.userExplicitSummary).toContain(fixture.preference.likedReasons);
        expect(analysis.uncertainties).not.toHaveLength(0);
      }
      const profile = await rebuild(result, "standard");
      expect(profile?.dimensions.map((item) => item.label).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.rawLabel).sort(),
      );
      if (!fixture.expectedAssertions.length) return;
      const snapshot = await loadProfileSnapshotItems(result.env, result.owner, "standard");
      if (!snapshot.snapshot) throw new Error("missing snapshot");
      const request = await createGenerationRequest(
        result.env,
        result.owner,
        "standard",
        generationRequestInputSchema.parse({
          profileSnapshotId: snapshot.snapshot.id,
          purpose: "具体的な好みを反映",
          selectedItemIds: snapshot.items.filter((item) => item.type === "dimension").map((item) => item.id),
        }),
        crypto.randomUUID(),
      );
      const { brief } = await compileBrief(result.env, result.owner, request.generationRequestId);
      expect(brief.preferenceSelections.map((item) => item.responseChannel).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.responseChannel).sort(),
      );
      for (const item of brief.preferenceSelections)
        expect(
          fixture.expectedAssertions.some(
            (expected) =>
              expected.rawLabel === item.label &&
              JSON.stringify(expected.conditions) === JSON.stringify(item.condition.conditions),
          ),
        ).toBe(true);
    },
  );
});

describe.each(["standard", "dark"] as const)("unresolved reaction in %s", (domain) => {
  it("preserves evidence and strength when setting a channel, including concurrent retries", async () => {
    const result = await setup(domain);
    const { env, owner, analysis, db } = result;
    const original = analysis.assertions[0];
    const input = preferenceReviewMutationSchema.parse({
      action: "set_response_channel",
      targetId: original.id,
      responseChannel: domain === "dark" ? "dark_character_liking" : "admiration",
    });
    if (input.action !== "set_response_channel") throw new Error("unexpected action");
    const key = crypto.randomUUID();
    const changed = await Promise.all(
      [1, 2].map(() => mutatePreferenceReview(env, owner, domain, analysis.id, input, key)),
    );
    expect(changed[0].changedId).toBe(changed[1].changedId);
    expect(changed.map((item) => item.replayed).sort()).toEqual([false, true]);
    const review = await loadEntryReview(env, owner, domain, result.params.entryId);
    const current = review?.preferenceAnalysis?.assertions.find((item) => item.id === changed[0].changedId);
    expect(current).toMatchObject({
      response_channel: input.responseChannel,
      confidence: original.confidence,
      strength: original.strength,
      explicitness: original.explicitness,
    });
    expect(
      db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(current?.id ?? ""),
    ).toEqual(db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(original.id));
    expect(current?.evidence.map(({ id: _id, ...item }) => item)).toEqual(
      original.evidence.map(({ id: _id, ...item }) => item),
    );
    expect(
      db.database.prepare("SELECT superseded_by_id FROM preference_assertions WHERE id=?").get(original.id)
        ?.superseded_by_id,
    ).toBe(current?.id);
    const profile = await rebuild(result, domain);
    expect(profile?.dimensions).toHaveLength(2);
    expect(profile?.dimensions.every((item) => item.evidenceCount === 1 && item.positiveScore > 0)).toBe(true);
    expect(new Set(profile?.dimensions.map((item) => item.positiveScore)).size).toBe(1);
    expect(new Set(profile?.dimensions.map((item) => item.confidence)).size).toBe(1);
    expect(await mutatePreferenceReview(env, owner, domain, analysis.id, input, key)).toMatchObject({ replayed: true });
  });
  it("keeps unknown channels in the profile without inventing a graph channel", async () => {
    const result = await setup(domain);
    const profile = await rebuild(result, domain);
    expect(profile?.dimensions).toHaveLength(2);
    expect(
      profile?.dimensions.every(
        (item) =>
          item.responseChannel === null && item.positiveScore > 0 && item.flags.includes("response_channel_unresolved"),
      ),
    ).toBe(true);
    expect(
      result.db.database
        .prepare("SELECT COUNT(*) n FROM graph_projection_nodes WHERE node_type='response_channel'")
        .get()?.n,
    ).toBe(0);
  });
  it("rolls back a channel correction if copying its evidence fails", async () => {
    const { env, owner, analysis, db } = await setup(domain);
    const before = db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all();
    const evidence = db.database.prepare("SELECT * FROM evidence_fragments ORDER BY id").all();
    db.database.exec(
      "CREATE TRIGGER fail_evidence_copy BEFORE INSERT ON evidence_fragments BEGIN SELECT RAISE(ABORT, 'injected copy failure'); END",
    );
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        { action: "set_response_channel", targetId: analysis.assertions[0].id, responseChannel: null },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("injected copy failure");
    expect(db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all()).toEqual(before);
    expect(db.database.prepare("SELECT * FROM evidence_fragments ORDER BY id").all()).toEqual(evidence);
  });
  it("rejects a foreign-domain channel and stale target without mutating the candidate", async () => {
    const { env, owner, analysis, db } = await setup(domain);
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        {
          action: "set_response_channel",
          targetId: analysis.assertions[0].id,
          responseChannel: domain === "dark" ? "admiration" : "dark_character_liking",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        { action: "set_response_channel", targetId: crypto.randomUUID(), responseChannel: null },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("PREFERENCE_REVIEW_STATE_CHANGED");
    expect(db.database.prepare("SELECT COUNT(*) n FROM preference_assertions").get()?.n).toBe(2);
  });
  it.each([false, true])("does not infer liking from an empty reason with selected=%s", async (selected) => {
    const fixture = {
      ...fixtures[0],
      preference: {
        likedReasons: "",
        responseChannels: selected ? [domain === "dark" ? "dark_character_liking" : "admiration"] : [],
      },
      expectedAssertions: [],
    };
    const result = await setup(domain, fixture, false);
    expect(result.analysis.assertions).toEqual([]);
  });
  it("extracts explicit negative and positive keyword examples without assigning a default channel", async () => {
    const fixture = {
      ...fixtures[0],
      preference: {
        likedReasons: "冷酷な知略が好き",
        dislikedReasons: "残酷に苦しめるところは苦手",
        responseChannels: [],
      },
      expectedAssertions: [],
    };
    const result = await setup(domain, fixture, false);
    expect(result.analysis.assertions.some((item) => item.polarity === "positive")).toBe(true);
    expect(result.analysis.assertions.some((item) => item.polarity === "negative")).toBe(true);
    expect(result.analysis.assertions.every((item) => item.response_channel === null)).toBe(true);
  });
  it.each(fixtures.filter((item) => !item.expectedAssertions.length))(
    "does not fabricate attributes for $caseId in the fake provider",
    async (fixture) => {
      const result = await setup(domain, fixture, false);
      expect(result.analysis.assertions).toEqual([]);
      expect(result.analysis.summary.userExplicitSummary).toContain(fixture.preference.likedReasons);
      expect(result.analysis.uncertainties.length).toBeGreaterThan(0);
    },
  );
});

// Expected outputs below are authored semantic examples, not evidence of live-model accuracy.
describe.each(["standard", "dark"] as const)("semantic scope transport in %s", (domain) => {
  // Opposite polarities, revised summary, dictionary mapping, and mixed known/unresolved channels.
  it.each(semanticFixtures.filter((item) => ["C11", "C12", "C04", "D09"].includes(item.caseId)))(
    "retains $caseId polarity, people and exceptions from audit to generation",
    async (frozen) => {
      const fixture: Fixture = {
        ...frozen,
        valueStances: [],
        expectedAssertions: frozen.expectedAssertions.map((item) => ({
          ...item,
          attributeStableKey: domain === "dark" ? null : item.attributeStableKey,
          responseChannel: domain === "dark" ? null : item.responseChannel,
        })),
      };
      // Simulate the observed inversion in generation; only the existing audit supplies the correction.
      if (fixture.caseId === "C11") {
        fixture.generatedCandidate = scriptedCandidate(fixture);
        fixture.generatedCandidate.preferenceAssertions[0].rawLabel = "支配・一方的服従として固定されない関係";
      }
      if (fixture.caseId === "C12") {
        fixture.generatedCandidate = scriptedCandidate(fixture);
        fixture.generatedCandidate.summary.userExplicitSummary = frozen.observedSummary;
      }
      const result = await setup(domain, fixture);
      expect(
        result.requests.filter((item) => /^(dark_)?preference_(analysis|audit)$/.test(item.operation)),
      ).toHaveLength(2);
      expect(result.analysis.summary.userExplicitSummary).toEqual([fixture.preference.likedReasons]);
      expect(result.analysis.assertions).toHaveLength(fixture.expectedAssertions.length);
      for (const expected of fixture.expectedAssertions) {
        const actual = result.analysis.assertions.find((item) => item.originalLabel === expected.rawLabel);
        expect(actual).toMatchObject({
          polarity: expected.polarity,
          context: expected.context,
          response_channel: expected.responseChannel,
        });
        expect(actual?.evidence).toEqual([
          expect.objectContaining({ quote: expected.quote, verificationStatus: "verified_quote" }),
        ]);
        if (expected.attributeStableKey) expect(actual?.attributeLabel).toBe("競争・宿敵");
      }
      const profile = await rebuild(result, domain);
      expect(profile?.dimensions).toHaveLength(fixture.expectedAssertions.length);
      const graph = await loadCurrentGraph(result.env, result.owner, domain);
      for (const expected of fixture.expectedAssertions) {
        const dimension = profile?.dimensions.find((item) => item.originalLabel === expected.rawLabel);
        expect(dimension?.condition).toEqual(expected.context);
        expect(dimension?.[expected.polarity === "negative" ? "positiveScore" : "negativeScore"]).toBe(0);
        expect(dimension?.[expected.polarity === "negative" ? "negativeScore" : "positiveScore"]).toBeGreaterThan(0);
        const edge = graph?.edges.find(
          (item) => item.id === `${expected.polarity === "negative" ? "dislike" : "like"}:${dimension?.id}`,
        );
        expect(edge?.attributes).toMatchObject({ ...expected.context, originalLabel: expected.rawLabel });
        expect(
          graph?.nodes.some(
            (item) =>
              item.type === "context" &&
              JSON.stringify(item.attributes.conditions) === JSON.stringify(expected.conditions),
          ),
        ).toBe(true);
      }
      const snapshot = await loadProfileSnapshotItems(result.env, result.owner, domain);
      if (!snapshot.snapshot) throw new Error("missing snapshot");
      const request = await createGenerationRequest(
        result.env,
        result.owner,
        domain,
        generationRequestInputSchema.parse({
          profileSnapshotId: snapshot.snapshot.id,
          purpose: "対象・条件を保持",
          selectedItemIds: snapshot.items.map((item) => item.id),
        }),
        crypto.randomUUID(),
      );
      const { brief } = await compileBrief(result.env, result.owner, request.generationRequestId);
      for (const expected of fixture.expectedAssertions) {
        const selection = brief.preferenceSelections.find((item) => item.label.includes(expected.rawLabel));
        expect(selection?.condition).toEqual(expected.context);
        expect(selection?.responseChannel).toBe(expected.responseChannel);
        expect(selection?.polarity?.[expected.polarity === "negative" ? "positive" : "negative"]).toBe(0);
      }
    },
  );

  it("keeps unknown value targets distinct by their saved relationship and scope", async () => {
    const fixture: Fixture = { ...semanticFixtures[0], expectedAssertions: [], valueStances: [] };
    fixture.valueStances = ["相互信頼", "支配・服従"].map((relationship, index) => ({
      targetType: "attribute",
      targetRef: index ? "relationship.dominance_or_submission_asymmetry" : "relationship.mutual_trust",
      orientation: "mixed",
      stance: "reject",
      explicitness: "user_explicit",
      confidence: 0.9,
      context: {
        ...context,
        subjects: ["中也", "太宰"],
        relationships: [relationship],
        conditions: ["ユーザーの関係解釈"],
      },
      evidence: [
        {
          sourceRef: "input:/preference/dislikedReasons",
          sourceUrl: null,
          inputPointer: "/preference/dislikedReasons",
          quote: fixture.preference.dislikedReasons ?? "",
          inferenceType: "direct",
        },
      ],
    }));
    const result = await setup(domain, fixture);
    expect(result.analysis.valueStances.map((item) => item.target_ref).sort()).toEqual(["支配・服従", "相互信頼"]);
    expect(result.analysis.valueStances.map((item) => item.originalTargetRef).sort()).toEqual(
      fixture.valueStances.map((item) => item.targetRef).sort(),
    );
    const profile = await rebuild(result, domain);
    expect(profile?.valueStances).toHaveLength(2);
    expect(profile?.valueStances.flatMap((item) => item.labels).sort()).toEqual(["支配・服従", "相互信頼"]);
    expect(profile?.valueStances.every((item) => item.scope?.conditions && item.count === 1)).toBe(true);
    const graph = await loadCurrentGraph(result.env, result.owner, domain);
    expect(
      graph?.nodes
        .filter((item) => item.type === "value_stance")
        .map((item) => item.label)
        .sort(),
    ).toEqual(["支配・服従：支持しない", "相互信頼：支持しない"]);
  });

  it("does not cross-apply positive and negative scores between conditions of the same attribute", async () => {
    const fixture: Fixture = {
      caseId: "conditional",
      preference: { likedReasons: "敵に冷たいところは好き。仲間に冷たいところは苦手。", responseChannels: [] },
      valueStances: [],
      expectedAssertions: [
        {
          rawLabel: "冷たさ",
          quote: "敵に冷たいところは好き。",
          polarity: "positive",
          responseChannel: null,
          conditions: ["敵への態度"],
        },
        {
          rawLabel: "冷たさ",
          quote: "仲間に冷たいところは苦手。",
          polarity: "negative",
          responseChannel: null,
          conditions: ["仲間への態度"],
        },
      ],
    };
    const result = await setup(domain, fixture);
    const profile = await rebuild(result, domain);
    const groups = groupProfileDimensions(profile?.dimensions ?? []);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
    for (const variant of groups[0].variants) {
      const positive = (variant.condition.conditions as string[])[0] === "敵への態度";
      expect(variant[positive ? "negativeScore" : "positiveScore"]).toBe(0);
      expect(variant[positive ? "positiveScore" : "negativeScore"]).toBeGreaterThan(0);
    }
  });
});

describe("negation counterexamples at the audit boundary", () => {
  it.each(["standard", "dark"] as const)(
    "keeps a liked negative state and removes unresolved polarity in %s",
    async (domain) => {
      const fixture: Fixture = {
        caseId: "negation-counterexample",
        preference: { likedReasons: "改心しないところが好き。冷たい人物が好きとは限らない。", responseChannels: [] },
        expectedAssertions: [
          {
            rawLabel: "改心しない状態",
            polarity: "positive",
            quote: "改心しないところが好き。",
            responseChannel: null,
            conditions: ["改心しない状態が続く場合"],
          },
        ],
        valueStances: [],
      };
      fixture.generatedCandidate = scriptedCandidate(fixture);
      fixture.generatedCandidate = preferenceCandidateSchema.parse({
        ...fixture.generatedCandidate,
        preferenceAssertions: [
          ...fixture.generatedCandidate.preferenceAssertions,
          { ...fixture.generatedCandidate.preferenceAssertions[0], rawLabel: "冷たい人物", polarity: "negative" },
        ],
      });
      fixture.uncertainties = [
        {
          topic: "冷たい人物への好み",
          reason: "好きとは限らないという記述から嫌悪は確定できない",
          recommendedQuestion: "冷たさへの好みはどの条件で変わりますか？",
        },
      ];
      const result = await setup(domain, fixture);
      expect(result.analysis.assertions).toHaveLength(1);
      expect(result.analysis.assertions[0]).toMatchObject({
        originalLabel: "改心しない状態",
        polarity: "positive",
        response_channel: null,
      });
      const profile = await rebuild(result, domain);
      expect(profile?.dimensions).toHaveLength(1);
      expect(profile?.dimensions[0].negativeScore).toBe(0);
      expect(
        result.requests.filter((item) => /^(dark_)?preference_(analysis|audit)$/.test(item.operation)),
      ).toHaveLength(2);
      expect(result.analysis.summary.userExplicitSummary[0]).toContain("冷たい人物が好きとは限らない");
      expect(result.analysis.uncertainties).toEqual(fixture.uncertainties);
    },
  );
});

describe.each(["standard", "dark"] as const)("invalid evidence remains excluded in %s", (domain) => {
  it("does not lend an invalid condition's confidence or value stance to the graph", async () => {
    const fixture: Fixture = {
      caseId: "invalid-condition",
      preference: {
        likedReasons: "敵に冷たいところは好き。",
        dislikedReasons: "仲間に冷たいところは苦手。",
        responseChannels: [],
      },
      expectedAssertions: [
        { rawLabel: "冷たさ", quote: "敵に冷たいところは好き。", responseChannel: null, conditions: ["敵への態度"] },
        {
          rawLabel: "冷たさ",
          quote: "仲間に冷たいところは苦手。",
          responseChannel: null,
          conditions: ["仲間への態度"],
          polarity: "negative",
          inputPointer: "/preference/dislikedReasons",
        },
      ],
    };
    const result = await setup(domain, fixture);
    const invalid = result.analysis.assertions.find((item) => item.polarity === "negative");
    if (!invalid) throw new Error("missing invalid fixture candidate");
    result.db.database
      .prepare(
        "UPDATE evidence_fragments SET verification_status='invalid' WHERE owner_id=? OR owner_type='value_stance_assertion'",
      )
      .run(invalid.id);
    result.db.database.prepare("UPDATE preference_assertions SET confidence=0.99 WHERE id=?").run(invalid.id);
    const profile = await rebuild(result, domain);
    expect(profile?.dimensions).toHaveLength(1);
    expect(profile?.dimensions[0].condition.conditions).toEqual(["敵への態度"]);
    expect(profile?.valueStances).toEqual([]);
    const graph = await loadCurrentGraph(result.env, result.owner, domain);
    expect(graph?.nodes.some((item) => item.type === "value_stance")).toBe(false);
    expect(graph?.edges.filter((item) => item.type === "has_attribute").map((item) => item.confidence)).toEqual([0.92]);
    expect(graph?.edges.some((item) => item.type === "dislikes")).toBe(false);
  });
});
