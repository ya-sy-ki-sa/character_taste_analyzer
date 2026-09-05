import { describe, expect, it, vi } from "vitest";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { generationRequestInputSchema } from "../shared/contracts/generation";
import { preferenceReviewMutationSchema } from "../shared/contracts/reviews";
import { selectExportPreferenceAssertions } from "../worker/features/account/repositories/exports";
import { activateAnalysisAndRebuild } from "../worker/features/analysis/activation";
import { processPreferenceAnalysis } from "../worker/features/analysis/preference";
import { loadRetainedPreferences } from "../worker/features/analysis/retention";
import { PREFERENCE_CONFIRMATION_POLICY } from "../worker/features/entries/preference-confirmation";
import { mutatePreferenceReview, rejectPreferenceAnalysisItem } from "../worker/features/entries/preference-review";
import { refinePreferenceInput } from "../worker/features/entries/refinement";
import { loadEntryReview } from "../worker/features/entries/review";
import { compileBrief } from "../worker/features/generation/brief";
import { createGenerationRequest } from "../worker/features/generation/request";
import { loadCurrentGraph } from "../worker/features/profile/graph";
import { loadProfileSnapshotItems } from "../worker/features/profile/snapshot";
import { sha256Hex } from "../worker/lib/crypto";
import fixtures from "./fixtures/manual-preference-corrections.json";
import { context, type Fixture, rebuild, setup } from "./support/preference-pipeline";

type TestContext = Awaited<ReturnType<typeof setup>>;
function fixtureFor(value: (typeof fixtures)[number]): Fixture {
  return {
    caseId: value.caseId,
    preference: { likedReasons: "元の申告", responseChannels: [] },
    valueStances: [],
    expectedAssertions:
      value.action === "update"
        ? [
            {
              rawLabel: "訂正前の対象",
              quote: "元の申告",
              responseChannel: null,
              conditions: [],
              context: value.context,
            },
          ]
        : [],
  };
}
function inputFor(value: (typeof fixtures)[number], domain: AnalysisDomain, targetId?: string) {
  return preferenceReviewMutationSchema.parse({
    action: value.action === "update" ? "update_preference" : "add_preference",
    targetId,
    rawLabel: value.rawLabel,
    attributeStableKey: domain === "dark" ? null : value.attributeStableKey,
    responseChannel: domain === "dark" ? null : value.responseChannel,
    polarity: value.polarity,
    strength: value.strength,
  });
}
const add = preferenceReviewMutationSchema.parse({
  action: "add_preference",
  rawLabel: "改心しない状態",
  attributeStableKey: null,
  responseChannel: null,
  polarity: "positive",
  strength: 0.8,
});
function counts(t: TestContext) {
  return [
    "sources",
    "evidence_fragments",
    "preference_assertions",
    "value_stance_assertions",
    "raw_attribute_mentions",
    "attribute_mappings",
  ].map((table) => t.db.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}
async function review(t: TestContext, domain: AnalysisDomain) {
  const result = await loadEntryReview(t.env, t.owner, domain, t.params.entryId);
  if (!result?.preferenceAnalysis) throw new Error("missing review");
  return result.preferenceAnalysis;
}

describe.each(["standard", "dark"] as const)("manual declaration in %s", (domain) => {
  it("carries declarations and scopes through additional analysis without adding supporting evidence", async () => {
    const fixture = fixtureFor(fixtures[0]);
    const t = await setup(domain, fixture);
    await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      inputFor(fixtures[0], domain, t.analysis.assertions[0].id),
      crypto.randomUUID(),
    );
    await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      { action: "add_value_stance", targetRef: "一方的な服従", stance: "reject", orientation: "mixed" },
      crypto.randomUUID(),
    );
    const before = await review(t, domain);
    const calls = t.requests.length;
    fixture.expectedAssertions = [];
    const refinement = await refinePreferenceInput(
      t.env,
      t.owner,
      domain,
      t.params.entryId,
      { mode: "questions", answers: [{ question: "条件はありますか？", answer: "訂正した条件を維持します。" }] },
      crypto.randomUUID(),
    );
    await processPreferenceAnalysis(t.env, { ...t.params, stage: "preference", refinementId: refinement.id });
    const after = await review(t, domain);
    expect(after.id).not.toBe(before.id);
    expect(after.assertions).toHaveLength(1);
    expect(after.valueStances).toHaveLength(1);
    for (const key of ["assertions", "valueStances"] as const) {
      expect(after[key][0].evidence).toEqual([
        expect.objectContaining({
          quote: before[key][0].evidence[0].quote,
          evidenceOrigin: "review",
          verificationStatus: "verified_quote",
        }),
      ]);
      const oldSource = t.db.database
        .prepare("SELECT source_id FROM evidence_fragments WHERE owner_id=?")
        .get(before[key][0].id);
      expect(
        t.db.database.prepare("SELECT source_id FROM evidence_fragments WHERE owner_id=?").get(after[key][0].id),
      ).toEqual(oldSource);
    }
    expect(after.assertions[0].context).toEqual(before.assertions[0].context);
    expect(after.valueStances[0].scope).toEqual(before.valueStances[0].scope);
    const profile = await rebuild({ ...t, analysis: after }, domain);
    expect(profile?.dimensions[0]).toMatchObject({ evidenceCount: 1, positiveScore: 0.855 });
    expect(profile?.valueStances).toHaveLength(1);
    const snapshot = await loadProfileSnapshotItems(t.env, t.owner, domain);
    expect(snapshot.items.find((item) => item.type === "value_stance")?.payload).toMatchObject({ confidence: 0.95 });
    expect(t.requests).toHaveLength(calls + 2);
  });
  it.each(fixtures)("restores $caseId / $key with exactly one review evidence", async (frozen) => {
    const t = await setup(domain, fixtureFor(frozen));
    const old = t.analysis.assertions[0];
    const before = old ? t.db.database.prepare("SELECT * FROM evidence_fragments WHERE owner_id=?").all(old.id) : [];
    const calls = t.requests.length;
    const input = inputFor(frozen, domain, old?.id);
    const saved = await mutatePreferenceReview(t.env, t.owner, domain, t.analysis.id, input, crypto.randomUUID());
    const detail = await review(t, domain);
    const current = detail.assertions[0];
    expect(detail.assertions).toHaveLength(1);
    expect(current).toMatchObject({
      id: saved.changedId,
      originalLabel: frozen.rawLabel,
      explicitness: "user_confirmed",
      confidence: 1,
      strength: frozen.strength,
      polarity: frozen.polarity,
    });
    expect(current.evidence).toEqual([
      expect.objectContaining({
        evidenceOrigin: "review",
        verificationStatus: "verified_quote",
        canNavigate: false,
        sourceUrl: null,
      }),
    ]);
    if (old) {
      expect(current.context).toEqual(frozen.context);
      expect(t.db.database.prepare("SELECT * FROM evidence_fragments WHERE owner_id=?").all(old.id)).toEqual(before);
      expect(
        t.db.database.prepare("SELECT status,superseded_by_id FROM preference_assertions WHERE id=?").get(old.id),
      ).toEqual({ status: "superseded", superseded_by_id: current.id });
    } else expect(current.context?.conditions).toEqual([]);
    const evidence = t.db.database.prepare("SELECT * FROM evidence_fragments WHERE owner_id=?").get(current.id);
    const source = t.db.database.prepare("SELECT * FROM sources WHERE id=?").get(evidence?.source_id ?? null);
    expect(source?.text_content).toBe(current.evidence[0].quote);
    expect(source?.content_hash).toBe(await sha256Hex(String(source?.text_content)));
    expect(evidence).toMatchObject({
      support_type: "supports",
      quote_start: 0,
      quote_end: String(source?.text_content).length,
      quote_hash: source?.content_hash,
    });
    expect(JSON.parse(String(source?.citation_json))).toMatchObject({
      policyVersion: PREFERENCE_CONFIRMATION_POLICY,
      previousAssertionId: old?.id ?? null,
      submitted: input,
      context: current.context,
    });
    expect(
      t.db.database.prepare("SELECT COUNT(*) n FROM source_set_items WHERE source_id=?").get(source?.id ?? null)?.n,
    ).toBe(0);
    const exported = await selectExportPreferenceAssertions(t.db.DB, t.owner).all<{
      id: string;
      originalLabel: string;
    }>();
    expect(exported.results.find((row) => row.id === current.id)?.originalLabel).toBe(frozen.rawLabel);
    const profile = await rebuild(t, domain);
    const dimension = profile?.dimensions[0];
    expect(profile?.dimensions).toHaveLength(1);
    expect(dimension).toMatchObject({ evidenceCount: 1, identityCount: 1, workCount: 1, classification: "emerging" });
    const score = frozen.strength * 0.95;
    expect(dimension?.[frozen.polarity === "negative" ? "negativeScore" : "positiveScore"]).toBeCloseTo(score, 6);
    expect(dimension?.confidence).toBeCloseTo(score * 0.71125, 6);
    // Independently recorded pre-fix outcome: no evidence fell back to quality 0.1.
    expect(frozen.observed.evidenceCount).toBe(0);
    expect(frozen.observed.score).toBeCloseTo(score * 0.1, 6);
    expect(frozen.observed.confidence).toBeCloseTo(score * 0.1 * 0.68875, 6);
    const graph = await loadCurrentGraph(t.env, t.owner, domain);
    expect(
      graph?.edges.find((edge) => edge.type === (frozen.polarity === "negative" ? "dislikes" : "likes")),
    ).toMatchObject({ evidenceCount: 1, weight: expect.closeTo(score, 6) });
    const snapshot = await loadProfileSnapshotItems(t.env, t.owner, domain);
    if (!snapshot.snapshot) throw new Error("missing snapshot");
    const request = await createGenerationRequest(
      t.env,
      t.owner,
      domain,
      generationRequestInputSchema.parse({
        profileSnapshotId: snapshot.snapshot.id,
        purpose: "訂正した好みを使う",
        selectedItemIds: snapshot.items.map((item) => item.id),
      }),
      crypto.randomUUID(),
    );
    const { brief } = await compileBrief(t.env, t.owner, request.generationRequestId);
    expect(brief.preferenceSelections[0].label).toContain(frozen.rawLabel);
    expect(brief.preferenceSelections[0].condition).toEqual(current.context);
    const retained = await loadRetainedPreferences(t.env, t.owner, t.analysis.id);
    expect(retained.preferences).toHaveLength(1);
    expect(retained.preferences[0].id).toBe(current.id);
    expect(t.requests).toHaveLength(calls);
  });

  it("preserves conditions while replacing polarity/target and does not revive an invalid old quote", async () => {
    const t = await setup(domain, fixtureFor(fixtures[0]));
    const old = t.analysis.assertions[0];
    t.db.database.prepare("UPDATE evidence_fragments SET verification_status='invalid' WHERE owner_id=?").run(old.id);
    t.db.database.prepare("UPDATE preference_assertions SET confidence=0 WHERE id=?").run(old.id);
    const saved = await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      preferenceReviewMutationSchema.parse({
        ...add,
        action: "update_preference",
        targetId: old.id,
        rawLabel: "二人を支配と服従に固定する描写",
        polarity: "negative",
      }),
      crypto.randomUUID(),
    );
    expect((await review(t, domain)).assertions[0].evidence).toEqual([
      expect.objectContaining({ evidenceOrigin: "review", verificationStatus: "verified_quote" }),
    ]);
    expect(
      t.db.database.prepare("SELECT verification_status FROM evidence_fragments WHERE owner_id=?").get(old.id)
        ?.verification_status,
    ).toBe("invalid");
    const profile = await rebuild(t, domain);
    expect(profile?.dimensions[0]).toMatchObject({ positiveScore: 0, negativeScore: 0.76, evidenceCount: 1 });
    expect(saved.changedId).not.toBe(old.id);
  });

  it("does not increase evidence or confidence over repeated edits and channel changes", async () => {
    const t = await setup(domain, { ...fixtureFor(fixtures[0]), expectedAssertions: [] });
    let saved = await mutatePreferenceReview(t.env, t.owner, domain, t.analysis.id, add, crypto.randomUUID());
    for (let i = 0; i < 4; i++)
      saved = await mutatePreferenceReview(
        t.env,
        t.owner,
        domain,
        t.analysis.id,
        preferenceReviewMutationSchema.parse({
          ...add,
          action: "update_preference",
          targetId: saved.changedId,
          rawLabel: `改心しない状態 ${i}`,
        }),
        crypto.randomUUID(),
      );
    const before = (await review(t, domain)).assertions[0];
    saved = await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      {
        action: "set_response_channel",
        targetId: saved.changedId,
        responseChannel: domain === "dark" ? "dark_character_liking" : "admiration",
      },
      crypto.randomUUID(),
    );
    const after = (await review(t, domain)).assertions[0];
    expect(after.confidence).toBe(before.confidence);
    expect(after.evidence.map(({ id: _id, ...e }) => e)).toEqual(before.evidence.map(({ id: _id, ...e }) => e));
    const profile = await rebuild(t, domain);
    expect(profile?.dimensions).toHaveLength(1);
    expect(profile?.dimensions[0]).toMatchObject({
      evidenceCount: 1,
      positiveScore: 0.76,
      confidence: 0.54055,
      classification: "emerging",
    });
  });

  it("adds, updates and rejects a value stance with its own declaration", async () => {
    const t = await setup(domain, { ...fixtureFor(fixtures[0]), expectedAssertions: [] });
    const saved = await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      { action: "add_value_stance", targetRef: "支配する描写", stance: "reject", orientation: "mixed" },
      crypto.randomUUID(),
    );
    const scoped = {
      ...context,
      subjects: ["中也", "太宰"],
      conditions: ["二人を一方的な服従に固定する場合"],
      exceptions: ["信頼への好意とは別"],
    };
    t.db.database
      .prepare("UPDATE value_stance_assertions SET scope_json=?,target_type='expression' WHERE id=?")
      .run(JSON.stringify(scoped), saved.changedId);
    const updated = await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      {
        action: "update_value_stance",
        targetId: saved.changedId,
        targetRef: "一方的服従に固定する描写",
        stance: "reject",
        orientation: "mixed",
      },
      crypto.randomUUID(),
    );
    const current = (await review(t, domain)).valueStances[0];
    expect(current.scope).toEqual(scoped);
    expect(current.evidence).toHaveLength(1);
    expect(current.evidence[0].evidenceOrigin).toBe("review");
    expect(
      t.db.database.prepare("SELECT target_type FROM value_stance_assertions WHERE id=?").get(updated.changedId)
        ?.target_type,
    ).toBe("expression");
    await rejectPreferenceAnalysisItem(t.env, t.owner, domain, t.analysis.id, updated.changedId);
    expect((await rebuild(t, domain))?.valueStances).toEqual([]);
  });

  it.each(["add_preference", "update_preference", "add_value_stance", "update_value_stance"] as const)(
    "serializes identical retries of %s",
    async (action) => {
      const t = await setup(domain, fixtureFor(fixtures[0]));
      const base = await mutatePreferenceReview(
        t.env,
        t.owner,
        domain,
        t.analysis.id,
        { action: "add_value_stance", targetRef: "旧対象", stance: "reject", orientation: "mixed" },
        crypto.randomUUID(),
      );
      const input = preferenceReviewMutationSchema.parse(
        action.includes("value_stance")
          ? { action, targetId: base.changedId, targetRef: "訂正対象", stance: "affirm", orientation: "mixed" }
          : { ...add, action, targetId: t.analysis.assertions[0].id },
      );
      const before = counts(t),
        key = crypto.randomUUID();
      const results = await Promise.all(
        [1, 2].map(() => mutatePreferenceReview(t.env, t.owner, domain, t.analysis.id, input, key)),
      );
      expect(results[0].changedId).toBe(results[1].changedId);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      const after = counts(t);
      expect(Number(after[0]) - Number(before[0])).toBe(1);
      expect(Number(after[1]) - Number(before[1])).toBe(1);
      expect(await mutatePreferenceReview(t.env, t.owner, domain, t.analysis.id, input, key)).toMatchObject({
        replayed: true,
      });
      expect(counts(t)).toEqual(after);
    },
  );

  it.each(["update_preference", "update_value_stance"] as const)(
    "admits only one competing %s without orphan records",
    async (action) => {
      const t = await setup(domain, fixtureFor(fixtures[0]));
      const target =
        action === "update_preference"
          ? t.analysis.assertions[0].id
          : (
              await mutatePreferenceReview(
                t.env,
                t.owner,
                domain,
                t.analysis.id,
                { action: "add_value_stance", targetRef: "旧対象", stance: "reject", orientation: "mixed" },
                crypto.randomUUID(),
              )
            ).changedId;
      const before = counts(t);
      const results = await Promise.allSettled(
        ["第一の訂正", "第二の訂正"].map((label) =>
          mutatePreferenceReview(
            t.env,
            t.owner,
            domain,
            t.analysis.id,
            preferenceReviewMutationSchema.parse(
              action === "update_preference"
                ? { ...add, action, targetId: target, rawLabel: label }
                : { action, targetId: target, targetRef: label, stance: "affirm", orientation: "mixed" },
            ),
            crypto.randomUUID(),
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const after = counts(t);
      expect(Number(after[0]) - Number(before[0])).toBe(1);
      expect(Number(after[1]) - Number(before[1])).toBe(1);
      expect(
        Number(after[action === "update_preference" ? 2 : 3]) - Number(before[action === "update_preference" ? 2 : 3]),
      ).toBe(1);
    },
  );

  it.each(["sources", "raw_attribute_mentions", "attribute_mappings", "preference_assertions", "evidence_fragments"])(
    "rolls back all writes when %s insertion fails",
    async (table) => {
      const t = await setup(domain, fixtureFor(fixtures[0]));
      const before = counts(t),
        old = t.analysis.assertions[0];
      const mappings = t.db.database.prepare("SELECT * FROM attribute_mappings ORDER BY id").all();
      t.db.database.exec(
        `CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
      );
      await expect(
        mutatePreferenceReview(
          t.env,
          t.owner,
          domain,
          t.analysis.id,
          preferenceReviewMutationSchema.parse({ ...add, action: "update_preference", targetId: old.id }),
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("injected failure");
      expect(counts(t)).toEqual(before);
      expect(t.db.database.prepare("SELECT status FROM preference_assertions WHERE id=?").get(old.id)?.status).toBe(
        "proposed",
      );
      expect(t.db.database.prepare("SELECT * FROM attribute_mappings ORDER BY id").all()).toEqual(mappings);
    },
  );

  it.each([
    "add_preference",
    "update_preference",
    "add_value_stance",
    "update_value_stance",
    "set_response_channel",
  ] as const)("blocks %s when confirmation wins after its initial read", async (action) => {
    const t = await setup(domain, fixtureFor(fixtures[0]));
    const stance = await mutatePreferenceReview(
      t.env,
      t.owner,
      domain,
      t.analysis.id,
      { action: "add_value_stance", targetRef: "旧対象", stance: "reject", orientation: "mixed" },
      crypto.randomUUID(),
    );
    const before = counts(t),
      originalBatch = t.env.DB.batch.bind(t.env.DB);
    vi.spyOn(t.env.DB, "batch").mockImplementationOnce(async (statements) => {
      await activateAnalysisAndRebuild(t.env, t.owner, domain, t.analysis.id);
      return originalBatch(statements);
    });
    const input =
      action === "set_response_channel"
        ? { action, targetId: t.analysis.assertions[0].id, responseChannel: null }
        : action.includes("value_stance")
          ? { action, targetId: stance.changedId, targetRef: "訂正対象", stance: "affirm", orientation: "mixed" }
          : { ...add, action, targetId: t.analysis.assertions[0].id };
    await expect(
      mutatePreferenceReview(
        t.env,
        t.owner,
        domain,
        t.analysis.id,
        preferenceReviewMutationSchema.parse(input),
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("PREFERENCE_REVIEW_STATE_CHANGED");
    expect(counts(t)).toEqual(before);
  });

  it.each(["owner", "domain", "revision", "latest run", "target"])(
    "checks %s again inside the content batch",
    async (boundary) => {
      const t = await setup(domain, fixtureFor(fixtures[0]));
      const before = counts(t),
        originalBatch = t.env.DB.batch.bind(t.env.DB);
      vi.spyOn(t.env.DB, "batch").mockImplementationOnce(async (statements) => {
        if (boundary === "owner") {
          const other = crypto.randomUUID();
          t.db.database
            .prepare(
              "INSERT INTO users (id,username,username_normalized,status,is_public,created_at,updated_at) SELECT ?,?,?,'active',0,created_at,updated_at FROM users WHERE id=?",
            )
            .run(other, other, other, t.owner);
          t.db.database.prepare("UPDATE analysis_runs SET owner_user_id=? WHERE id=?").run(other, t.analysis.id);
        }
        if (boundary === "domain")
          t.db.database
            .prepare("UPDATE user_character_entries SET analysis_domain=? WHERE id=?")
            .run(domain === "dark" ? "standard" : "dark", t.params.entryId);
        if (boundary === "revision")
          t.db.database
            .prepare("UPDATE user_character_entries SET active_revision_number=2 WHERE id=?")
            .run(t.params.entryId);
        if (boundary === "latest run") {
          const row = t.db.database.prepare("SELECT * FROM analysis_runs WHERE id=?").get(t.analysis.id);
          if (!row) throw new Error("missing run");
          const copy = { ...row, id: crypto.randomUUID(), run_generation: Number(row.run_generation) + 1 };
          t.db.database
            .prepare(
              `INSERT INTO analysis_runs (${Object.keys(copy).join(",")}) VALUES (${Object.keys(copy)
                .map(() => "?")
                .join(",")})`,
            )
            .run(...Object.values(copy));
        }
        if (boundary === "target")
          t.db.database
            .prepare("UPDATE preference_assertions SET status='rejected' WHERE id=?")
            .run(t.analysis.assertions[0].id);
        return originalBatch(statements);
      });
      await expect(
        mutatePreferenceReview(
          t.env,
          t.owner,
          domain,
          t.analysis.id,
          preferenceReviewMutationSchema.parse({
            ...add,
            action: "update_preference",
            targetId: t.analysis.assertions[0].id,
          }),
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("PREFERENCE_REVIEW_STATE_CHANGED");
      expect(counts(t)).toEqual(before);
    },
  );

  it.each(["value_stance_assertions", "evidence_fragments"])(
    "rolls back the value declaration when %s insertion fails",
    async (table) => {
      const t = await setup(domain, fixtureFor(fixtures[0]));
      const old = await mutatePreferenceReview(
        t.env,
        t.owner,
        domain,
        t.analysis.id,
        { action: "add_value_stance", targetRef: "旧対象", stance: "reject", orientation: "mixed" },
        crypto.randomUUID(),
      );
      const before = counts(t);
      t.db.database.exec(
        `CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
      );
      await expect(
        mutatePreferenceReview(
          t.env,
          t.owner,
          domain,
          t.analysis.id,
          {
            action: "update_value_stance",
            targetId: old.changedId,
            targetRef: "訂正対象",
            stance: "affirm",
            orientation: "mixed",
          },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("injected failure");
      expect(counts(t)).toEqual(before);
      expect(
        t.db.database.prepare("SELECT status FROM value_stance_assertions WHERE id=?").get(old.changedId)?.status,
      ).toBe("corrected");
    },
  );
});
