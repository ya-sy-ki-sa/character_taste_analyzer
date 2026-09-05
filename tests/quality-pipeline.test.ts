// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { anyEntryDraftSchema } from "../shared/contracts/entries";
import { generationRequestInputSchema } from "../shared/contracts/generation";
import { activateAnalysisAndRebuild } from "../worker/features/analysis/activation";
import { loadConfirmedUnderstanding } from "../worker/features/analysis/confirmed-understanding";
import { processPreferenceAnalysis } from "../worker/features/analysis/preference";
import { processCharacterAnalysis } from "../worker/features/analysis/understanding";
import { createEntry } from "../worker/features/entries/create";
import { refinePreferenceInput } from "../worker/features/entries/refinement";
import { loadEntryReview } from "../worker/features/entries/review";
import { confirmUnderstanding, mutateUnderstandingReview } from "../worker/features/entries/understanding-review";
import { deleteGeneration } from "../worker/features/generation/delete";
import {
  createGenerationFeedback,
  reviewGenerationFeedback,
  selectGenerationCandidate,
} from "../worker/features/generation/feedback";
import { listGenerations } from "../worker/features/generation/history";
import { processGeneration } from "../worker/features/generation/process";
import { createGenerationRequest } from "../worker/features/generation/request";
import { loadCurrentProfile, processProfileRebuild } from "../worker/features/profile/projection";
import { loadInputProvenanceSources } from "../worker/platform/provenance/sources";
import type { Env } from "../worker/types";
import { testDatabase } from "./support/database";

const databases: Array<ReturnType<typeof testDatabase>> = [];
function present<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error("Expected test data to be present");
  return value;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = testDatabase();
  databases.push(db);
  const owner = crypto.randomUUID(),
    now = new Date().toISOString();
  db.database
    .prepare(
      "INSERT INTO users (id,username,username_normalized,status,is_public,created_at,updated_at) VALUES (?,?,?,'active',0,?,?)",
    )
    .run(owner, owner, owner, now, now);
  const env = {
    DB: db.DB,
    ENVIRONMENT: "local",
    AUTH_PEPPER: "quality-test-only",
    LLM_PROVIDER: "fake",
    LLM_MODEL: "fake",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake",
    ANALYSIS_DAILY_QUOTA: "100",
    GENERATION_DAILY_QUOTA: "100",
  } as Env;
  return { db, owner, env };
}
async function understood(domain: AnalysisDomain, empty = false) {
  const context = setup(),
    { env, owner } = context;
  const draft = anyEntryDraftSchema.parse({
    registrationType: "original",
    characterName: "試験対象",
    characterBasicInfo: "冷酷な知略で支配を行う悪役。外部から操作されることもある。",
    preference: {
      likedReasons: empty ? "" : "冷酷な知略で支配する悪役としての姿が好き。改心しないところも好き。",
      responseChannels: [domain === "dark" ? "villain_role_fascination" : "narrative_interest"],
    },
    ...(domain === "dark" ? { darkContext: { focusDescription: "外部から操作されて敵対する状態" } } : {}),
  });
  const entry = await createEntry(env, owner, domain, draft, crypto.randomUUID());
  const params = {
    jobId: entry.jobId,
    ownerUserId: owner,
    entryId: entry.entryId,
    stage: "understanding" as const,
    inputGeneration: 1,
    analysisDomain: domain,
  };
  await processCharacterAnalysis(env, params);
  const detail = await loadEntryReview(env, owner, domain, entry.entryId);
  expect(
    detail?.understanding,
    JSON.stringify(context.db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
  ).toBeTruthy();
  return { ...context, params, detail: present(detail) };
}
async function analyzed(domain: AnalysisDomain, empty = false) {
  const context = await understood(domain, empty);
  const { env, owner, params, detail } = context;
  await confirmUnderstanding(env, owner, domain, detail?.understanding?.id as string);
  await processPreferenceAnalysis(env, { ...params, stage: "preference" });
  const reviewed = await loadEntryReview(env, owner, domain, params.entryId);
  expect(
    reviewed?.preferenceAnalysis,
    JSON.stringify(context.db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
  ).toBeTruthy();
  return { ...context, params, detail: reviewed as NonNullable<typeof reviewed> };
}
describe("quality pipeline against current D1 schema", () => {
  it("reloads corrected assertions, original evidence, scope and confirmed customization deltas", async () => {
    const { db, env, owner } = setup();
    const draft = anyEntryDraftSchema.parse({
      registrationType: "customized_existing",
      identityResolution: { mode: "new" },
      representationType: "alternate_setting",
      workTitle: "架空作品",
      baseCharacterName: "原典の人物",
      characterName: "訂正対象の人物",
      preferenceContext: "敵対する期間だけ",
      customizationDescription: "冷酷な策略家だが、改心しない別設定",
      preference: { likedReasons: "物語上の知略の応酬が好き", responseChannels: ["narrative_interest"] },
    });
    const created = await createEntry(env, owner, "standard", draft, crypto.randomUUID());
    const params = {
      jobId: created.jobId,
      ownerUserId: owner,
      entryId: created.entryId,
      analysisDomain: "standard" as const,
      stage: "understanding" as const,
      inputGeneration: 1,
    };
    await processCharacterAnalysis(env, params);
    const detail = await loadEntryReview(env, owner, "standard", created.entryId);
    const snapshot = detail?.understanding;
    expect(snapshot).toBeTruthy();
    const original = snapshot?.assertions[0];
    const removed = snapshot?.assertions[1];
    expect(removed).toBeTruthy();
    await mutateUnderstandingReview(
      env,
      owner,
      "standard",
      snapshot?.id as string,
      {
        action: "update_assertion",
        targetId: original?.id as string,
        rawLabel: "訂正した特徴",
        valueText: "強制された行動であり本人の意思ではない",
        attributeStableKey: null,
      },
      crypto.randomUUID(),
    );
    await mutateUnderstandingReview(
      env,
      owner,
      "standard",
      snapshot?.id as string,
      { action: "delete_assertion", targetId: removed?.id as string },
      crypto.randomUUID(),
    );
    await mutateUnderstandingReview(
      env,
      owner,
      "standard",
      snapshot?.id as string,
      {
        action: "add_delta",
        operation: "add",
        beforeValue: null,
        afterValue: "敵対時にだけ言葉を失う",
        reasonText: "確認済みのカスタム差分",
      },
      crypto.randomUUID(),
    );
    // Edits are already citable before confirmation or another analysis runs.
    const reviewEvidence = db.database
      .prepare(
        "SELECT e.excerpt_text,e.verification_status FROM evidence_fragments e JOIN character_assertions a ON a.id=e.owner_id WHERE a.snapshot_id=? AND e.evidence_origin='review' AND a.status='corrected'",
      )
      .all(snapshot?.id as string);
    expect(reviewEvidence).toEqual([
      { excerpt_text: "強制された行動であり本人の意思ではない", verification_status: "verified_quote" },
    ]);
    await confirmUnderstanding(env, owner, "standard", snapshot?.id as string);
    const confirmed = await loadConfirmedUnderstanding(env, owner, snapshot?.id as string);
    expect(confirmed.assertions.some((item) => item.valueText === removed?.value_text)).toBe(false);
    expect(confirmed.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          valueText: "強制された行動であり本人の意思ではない",
          explicitness: "user_explicit",
          confidence: 1,
          scopeText: "敵対する期間だけ",
        }),
      ]),
    );
    expect(confirmed.customizationDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          afterValue: "敵対時にだけ言葉を失う",
          reasonText: "確認済みのカスタム差分",
          explicitness: "user_explicit",
        }),
      ]),
    );
    expect(confirmed.excluded.some((item) => item.value_text === removed?.value_text)).toBe(true);
    await processPreferenceAnalysis(env, { ...params, stage: "preference" });
    const withReviewEvidence = await loadConfirmedUnderstanding(env, owner, snapshot?.id as string);
    expect(
      withReviewEvidence.assertions.find((item) => item.valueText === "強制された行動であり本人の意思ではない")
        ?.evidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inferenceType: "direct", quote: "強制された行動であり本人の意思ではない" }),
      ]),
    );
    const saved = db.database
      .prepare(
        "SELECT a.value_text,a.confidence,a.explicitness FROM character_assertions a WHERE a.snapshot_id=? AND a.status IN ('confirmed','corrected') ORDER BY a.ordinal,a.id",
      )
      .all(snapshot?.id as string);
    expect(confirmed.assertions.map((item) => [item.valueText, item.confidence, item.explicitness])).toEqual(
      saved.map((item) => [item.value_text, item.confidence, item.explicitness]),
    );
  });
  it("keeps review provenance atomic and excludes superseded or deleted edits", async () => {
    const { db, env, owner, detail } = await understood("standard");
    const snapshotId = detail.understanding?.id as string;
    const sourceSetId = db.database
      .prepare(
        "SELECT er.source_set_id FROM entry_revisions er JOIN user_character_entries e ON e.id=er.entry_id WHERE e.owner_user_id=?",
      )
      .get(owner)?.source_set_id as string;
    const key = crypto.randomUUID();
    const input = {
      action: "add_assertion" as const,
      rawLabel: "手動設定",
      valueText: "訂正前の設定",
      attributeStableKey: null,
    };
    const added = await mutateUnderstandingReview(env, owner, "standard", snapshotId, input, key);
    await mutateUnderstandingReview(env, owner, "standard", snapshotId, input, key);
    expect(
      db.database.prepare("SELECT COUNT(*) AS count FROM evidence_fragments WHERE owner_id=?").get(added.changedId)
        ?.count,
    ).toBe(1);
    const changed = await mutateUnderstandingReview(
      env,
      owner,
      "standard",
      snapshotId,
      {
        action: "update_assertion",
        targetId: added.changedId,
        rawLabel: "手動設定",
        valueText: "訂正後の設定",
        attributeStableKey: null,
      },
      crypto.randomUUID(),
    );
    let sources = await loadInputProvenanceSources(env, sourceSetId);
    expect(sources.some((source) => source.text === "訂正前の設定")).toBe(false);
    expect(sources.some((source) => source.text === "訂正後の設定")).toBe(true);
    await mutateUnderstandingReview(
      env,
      owner,
      "standard",
      snapshotId,
      { action: "delete_assertion", targetId: changed.changedId },
      crypto.randomUUID(),
    );
    sources = await loadInputProvenanceSources(env, sourceSetId);
    expect(sources.some((source) => source.text === "訂正後の設定")).toBe(false);
    db.database.exec(
      "CREATE TRIGGER reject_review_evidence BEFORE INSERT ON evidence_fragments WHEN NEW.evidence_origin='review' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    await expect(
      mutateUnderstandingReview(
        env,
        owner,
        "standard",
        snapshotId,
        { ...input, valueText: "失敗した訂正" },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    expect(
      db.database.prepare("SELECT COUNT(*) AS count FROM character_assertions WHERE value_text='失敗した訂正'").get()
        ?.count,
    ).toBe(0);
    expect(
      db.database.prepare("SELECT COUNT(*) AS count FROM sources WHERE text_content='失敗した訂正'").get()?.count,
    ).toBe(0);
  });

  it.each(["standard", "dark"] as const)(
    "generates and selects validated candidates, confirms feedback only explicitly (%s)",
    async (domain) => {
      const { db, env, owner, params, detail } = await analyzed(domain);
      const activated = await activateAnalysisAndRebuild(env, owner, domain, detail.preferenceAnalysis?.id as string);
      await processProfileRebuild(env, {
        jobId: activated.profileJobId,
        ownerUserId: owner,
        desiredGeneration: activated.freshness.desiredGeneration,
      });
      const ids = db.database
        .prepare(
          "SELECT i.id FROM profile_snapshot_items i JOIN profile_snapshots s ON s.id=i.profile_snapshot_id WHERE i.analysis_domain=? ORDER BY s.profile_generation DESC,i.ordinal LIMIT 3",
        )
        .all(domain)
        .map((row) => row.id as string);
      expect(ids.length).toBeGreaterThan(0);
      const generation = await createGenerationRequest(
        env,
        owner,
        domain,
        generationRequestInputSchema.parse({
          profileSnapshotId: db.database
            .prepare("SELECT profile_snapshot_id FROM profile_snapshot_items WHERE id=?")
            .get(ids[0])?.profile_snapshot_id,
          mode: "faithful",
          purpose: "独創的な人物を作成",
          selectedItemIds: ids,
          prohibitedItemIds: [],
        }),
        crypto.randomUUID(),
      );
      await processGeneration(env, {
        jobId: generation.jobId as string,
        ownerUserId: owner,
        generationRequestId: generation.generationRequestId,
        inputGeneration: 1,
        analysisDomain: domain,
      });
      const [result] = await listGenerations(env, owner, domain);
      expect(
        result.status,
        JSON.stringify(db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
      ).toBe("generated");
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM generation_candidates").get()?.count).toBe(3);
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates.every((candidate) => !candidate.selected)).toBe(true);
      db.database.exec("SAVEPOINT missing_candidates");
      db.database
        .prepare("DELETE FROM generation_candidates WHERE generation_request_id=?")
        .run(result.generationRequestId);
      expect(await listGenerations(env, owner, domain)).toEqual([]);
      db.database.exec("ROLLBACK TO missing_candidates; RELEASE missing_candidates");

      const candidate = result.candidates.at(-1) as (typeof result.candidates)[number];
      await expect(
        selectGenerationCandidate(env, "other-owner", domain, result.generationRequestId, candidate.id),
      ).rejects.toThrow();
      await selectGenerationCandidate(env, owner, domain, result.generationRequestId, candidate.id);
      expect(
        (await listGenerations(env, owner, domain))[0].candidates
          .filter((item) => item.selected)
          .map((item) => item.id),
      ).toEqual([candidate.id]);
      const key = crypto.randomUUID(),
        input = {
          candidateId: candidate.id,
          outputPointer: "/personality/summary",
          reason: "物語の敵対時の知略として好み",
          attributeStableKey: domain === "dark" ? "dark.competence.villainous_intellect" : "competence.intelligence",
          polarity: "positive" as const,
          responseChannel: domain === "dark" ? ("villain_role_fascination" as const) : ("narrative_interest" as const),
          scope: "敵対時のみ",
        };
      const attribute = db.database
        .prepare(
          `SELECT d.stable_key FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id WHERE v.analysis_domain=? AND d.status='active' LIMIT 1`,
        )
        .get(domain);
      input.attributeStableKey = attribute?.stable_key as string;
      const feedback = await createGenerationFeedback(env, owner, domain, input, key);
      expect((await createGenerationFeedback(env, owner, domain, input, key)).replayed).toBe(true);
      await expect(createGenerationFeedback(env, owner, domain, { ...input, reason: "変更" }, key)).rejects.toThrow(
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
      );
      const before = db.database
        .prepare("SELECT desired_generation FROM projection_rebuild_states WHERE owner_user_id=?")
        .get(owner)?.desired_generation;
      expect(db.database.prepare("SELECT status FROM generation_feedback WHERE id=?").get(feedback.id)?.status).toBe(
        "proposed",
      );
      const accepted = await reviewGenerationFeedback(env, owner, domain, feedback.id, "confirm");
      expect(accepted.outboxEventId).toBeTruthy();
      expect((await reviewGenerationFeedback(env, owner, domain, feedback.id, "confirm")).outboxEventId).toBeNull();
      const job = db.database
        .prepare(
          "SELECT id,input_generation FROM jobs WHERE job_type='profile_rebuild' ORDER BY input_generation DESC LIMIT 1",
        )
        .get();
      expect(Number(job?.input_generation)).toBe(Number(before) + 1);
      await processProfileRebuild(env, {
        jobId: job?.id as string,
        ownerUserId: owner,
        desiredGeneration: job?.input_generation as number,
      });
      expect(db.database.prepare("SELECT status,error_code FROM jobs WHERE id=?").get(job?.id as string)?.status).toBe(
        "succeeded",
      );
      const dimensionForFeedback = async () =>
        (await loadCurrentProfile(env, owner, domain))?.dimensions.find(
          (dimension) =>
            dimension.stableKey === input.attributeStableKey && dimension.condition.entryScope === input.scope,
        );
      expect((await dimensionForFeedback())?.identityCount).toBe(1);
      const secondFeedback = await createGenerationFeedback(
        env,
        owner,
        domain,
        { ...input, outputPointer: "/abilitiesAndLimits/summary", reason: "この能力も同じ条件で好き" },
        crypto.randomUUID(),
      );
      await deleteGeneration(env, owner, domain, generation.generationRequestId);
      expect(
        db.database.prepare("SELECT candidate_id,status FROM generation_feedback WHERE id=?").get(feedback.id),
      ).toMatchObject({ candidate_id: null, status: "confirmed" });
      await reviewGenerationFeedback(env, owner, domain, secondFeedback.id, "confirm");
      const nextJob = db.database
        .prepare(
          "SELECT id,input_generation FROM jobs WHERE job_type='profile_rebuild' ORDER BY input_generation DESC LIMIT 1",
        )
        .get();
      await processProfileRebuild(env, {
        jobId: nextJob?.id as string,
        ownerUserId: owner,
        desiredGeneration: nextJob?.input_generation as number,
      });
      expect((await dimensionForFeedback())?.identityCount).toBe(1);
      expect(params.entryId).toBeTruthy();
    },
  );
  it("treats absent evidence as empty, supports answers and low-confidence hypotheses without replacing understanding", async () => {
    const { db, env, owner, params, detail } = await analyzed("standard", true);
    expect(detail.preferenceAnalysis?.assertions).toHaveLength(0);
    const snapshotId = detail.understanding?.id as string;
    const confirmed = await loadConfirmedUnderstanding(env, owner, snapshotId);
    expect(confirmed.assertions[0].evidence.length).toBeGreaterThan(0);
    expect(confirmed.assertions[0].confidence).not.toBe(0.8);
    const refinement = await refinePreferenceInput(
      env,
      owner,
      "standard",
      params.entryId,
      {
        mode: "questions",
        answers: [{ question: "何に惹かれましたか？", answer: "知略の応酬を物語として楽しんでいます" }],
      },
      crypto.randomUUID(),
    );
    await processPreferenceAnalysis(env, { ...params, stage: "preference" });
    expect(db.database.prepare("SELECT status FROM jobs WHERE id=?").get(params.jobId)?.status).toBe("queued");
    await processPreferenceAnalysis(env, { ...params, stage: "preference", refinementId: refinement.id });
    let next = await loadEntryReview(env, owner, "standard", params.entryId);
    expect(
      next?.entry.status,
      JSON.stringify(db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
    ).toBe("analysis_review");
    expect(next?.understanding?.id).toBe(snapshotId);
    await expect(
      activateAnalysisAndRebuild(env, owner, "standard", detail.preferenceAnalysis?.id as string),
    ).rejects.toThrow("PREFERENCE_REVIEW_NOT_FOUND");
    expect(next?.preferenceAnalysis?.assertions.length).toBeGreaterThan(0);
    const beforeHypotheses = next?.preferenceAnalysis;
    const hypothesis = await refinePreferenceInput(
      env,
      owner,
      "standard",
      params.entryId,
      { mode: "hypotheses" },
      crypto.randomUUID(),
    );
    await processPreferenceAnalysis(env, { ...params, stage: "preference", refinementId: hypothesis.id });
    next = await loadEntryReview(env, owner, "standard", params.entryId);
    expect(next?.preferenceAnalysis?.id).toBe(beforeHypotheses?.id);
    expect(next?.preferenceAnalysis?.assertions).toEqual(beforeHypotheses?.assertions);
    expect(next?.preferenceAnalysis?.hypothesisPreview?.id).toBe(hypothesis.id);
    expect(next?.preferenceAnalysis?.hypothesisPreview?.candidates?.length).toBeGreaterThan(0);
    expect(
      db.database.prepare("SELECT COUNT(*) AS count FROM preference_assertions WHERE status='confirmed'").get()?.count,
    ).toBe(0);
  });
  it.each(["standard", "dark"] as const)(
    "previews, regenerates and selects hypotheses without replacing existing preferences (%s)",
    async (domain) => {
      const { db, env, owner, params, detail } = await analyzed(domain);
      const initialRun = present(detail.preferenceAnalysis);
      db.database
        .prepare(
          "UPDATE preference_assertions SET status='corrected',explicitness='user_explicit',confidence=0.91 WHERE id=?",
        )
        .run(initialRun.assertions[0].id);
      if (initialRun.assertions[1])
        db.database
          .prepare("UPDATE preference_assertions SET status='rejected' WHERE id=?")
          .run(initialRun.assertions[1].id);
      const initial = present((await loadEntryReview(env, owner, domain, params.entryId))?.preferenceAnalysis);
      const originalRows = db.database
        .prepare("SELECT * FROM preference_assertions WHERE analysis_run_id=? ORDER BY id")
        .all(initial.id);
      const request = async () => {
        const refinement = await refinePreferenceInput(
          env,
          owner,
          domain,
          params.entryId,
          { mode: "hypotheses" },
          crypto.randomUUID(),
        );
        await processPreferenceAnalysis(env, { ...params, stage: "preference", refinementId: refinement.id });
        const detail = await loadEntryReview(env, owner, domain, params.entryId);
        expect(detail?.preferenceAnalysis?.id).toBe(initial.id);
        expect(detail?.preferenceAnalysis?.assertions).toEqual(initial.assertions);
        expect(db.database.prepare("SELECT COUNT(*) AS count FROM analysis_runs").get()?.count).toBe(1);
        return present(detail?.preferenceAnalysis?.hypothesisPreview);
      };
      const first = await request();
      expect(first.candidates?.length).toBeGreaterThan(0);
      // A reload returns the exact preview; merely generating it cannot change profile input.
      expect(
        (await loadEntryReview(env, owner, domain, params.entryId))?.preferenceAnalysis?.hypothesisPreview,
      ).toEqual(first);
      const second = await request();
      expect(second.id).not.toBe(first.id);
      expect(second.candidates).not.toEqual(first.candidates);
      await expect(
        refinePreferenceInput(
          env,
          owner,
          domain,
          params.entryId,
          { mode: "selection", hypothesisBatchId: first.id, selectedHypothesisIds: [present(first.candidates)[0].id] },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("仮説候補が更新");
      await expect(
        refinePreferenceInput(
          env,
          "other-owner",
          domain,
          params.entryId,
          {
            mode: "selection",
            hypothesisBatchId: second.id,
            selectedHypothesisIds: [present(second.candidates)[0].id],
          },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow();
      await expect(
        refinePreferenceInput(
          env,
          owner,
          domain,
          params.entryId,
          { mode: "selection", hypothesisBatchId: second.id, selectedHypothesisIds: [crypto.randomUUID()] },
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("見つかりません");
      const selected = present(second.candidates)[0];
      const selection = await refinePreferenceInput(
        env,
        owner,
        domain,
        params.entryId,
        { mode: "selection", hypothesisBatchId: second.id, selectedHypothesisIds: [selected.id] },
        crypto.randomUUID(),
      );
      await processPreferenceAnalysis(env, { ...params, stage: "preference", refinementId: selection.id });
      const next = present((await loadEntryReview(env, owner, domain, params.entryId))?.preferenceAnalysis);
      expect(next.id).not.toBe(initial.id);
      expect(next.qualityContext.refinementMode).toBe("selection");
      expect(next.assertions).toHaveLength(initial.assertions.length + 1);
      for (const old of initial.assertions) {
        const copy = next.assertions.find(
          (item) =>
            item.stable_key === old.stable_key &&
            item.response_channel === old.response_channel &&
            item.polarity === old.polarity,
        );
        expect(copy).toMatchObject({
          raw_label: old.raw_label,
          explicitness: old.explicitness,
          confidence: old.confidence,
          strength: old.strength,
          status: old.status,
        });
        expect(copy?.evidence.map(({ id: _id, ...value }) => value)).toEqual(
          old.evidence.map(({ id: _id, ...value }) => value),
        );
      }
      const addition = next.assertions.find(
        (item) => item.stable_key === selected.attributeStableKey && item.response_channel === selected.responseChannel,
      );
      expect(addition?.explicitness).toBe("user_explicit");
      expect(addition?.status).toBe("proposed");
      expect(addition?.evidence.length).toBeGreaterThan(0);
      expect(next.hypothesisPreview).toBeNull();
      expect(
        db.database.prepare("SELECT * FROM preference_assertions WHERE analysis_run_id=? ORDER BY id").all(initial.id),
      ).toEqual(originalRows);
      expect(
        db.database.prepare("SELECT COUNT(*) AS count FROM preference_assertions WHERE status='confirmed'").get()
          ?.count,
      ).toBe(0);
    },
  );
});
