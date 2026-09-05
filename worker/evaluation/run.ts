import { evaluationDatabase } from "../../scripts/lib/evaluation-database";
import { anyEntryDraftSchema, generationRequestInputSchema } from "../../shared/schemas";
import { activateAnalysisAndRebuild, processCharacterAnalysis, processPreferenceAnalysis } from "../services/analysis";
import { confirmUnderstanding, createEntry, loadEntryReview } from "../services/entries";
import { createGenerationRequest, listGenerations, processGeneration } from "../services/generation";
import { processProfileRebuild } from "../services/profile";
import type { Env } from "../types";
import { QUALITY_FIXTURE_VERSION, qualityCases } from "./cases";

export async function runQualityEvaluation(
  bindings: Env,
  limit = qualityCases.length,
  options: { generate?: boolean; only?: string[] } = {},
) {
  const results = [];
  for (const fixture of qualityCases
    .filter((item) => !options.only?.length || options.only.includes(item.id))
    .slice(0, limit)) {
    const db = evaluationDatabase();
    const owner = crypto.randomUUID();
    const now = new Date().toISOString();
    db.database
      .prepare(
        "INSERT INTO users (id,username,username_normalized,status,is_public,created_at,updated_at) VALUES (?,?,?,'active',0,?,?)",
      )
      .run(owner, owner, owner, now, now);
    const env = { ...bindings, DB: db.DB, ANALYSIS_DAILY_QUOTA: "1000", GENERATION_DAILY_QUOTA: "1000" };
    try {
      const input = anyEntryDraftSchema.parse({
        registrationType: "original",
        characterName: `評価対象 ${fixture.id}`,
        characterBasicInfo: fixture.basicInfo,
        preferenceContext: fixture.scope,
        preference: {
          likedReasons: fixture.likedReasons,
          dislikedReasons: fixture.dislikedReasons,
          responseChannels: [],
        },
        ...(fixture.domain === "dark" ? { darkContext: { focusDescription: fixture.focus } } : {}),
      });
      const entry = await createEntry(env, owner, fixture.domain, input, crypto.randomUUID());
      const params = {
        jobId: entry.jobId,
        ownerUserId: owner,
        entryId: entry.entryId,
        analysisDomain: fixture.domain,
        inputGeneration: 1,
        stage: "understanding" as const,
      };
      await processCharacterAnalysis(env, params);
      const understanding = await loadEntryReview(env, owner, fixture.domain, entry.entryId);
      if (!understanding?.understanding) throw new Error("EVALUATION_UNDERSTANDING_UNAVAILABLE");
      await confirmUnderstanding(env, owner, fixture.domain, understanding.understanding.id);
      await processPreferenceAnalysis(env, { ...params, stage: "preference" });
      const detail = await loadEntryReview(env, owner, fixture.domain, entry.entryId);
      if (!detail?.preferenceAnalysis) throw new Error("EVALUATION_PREFERENCE_UNAVAILABLE");
      let generation: unknown = null;
      if (options.generate && detail.preferenceAnalysis.assertions.length) {
        const profile = await activateAnalysisAndRebuild(env, owner, fixture.domain, detail.preferenceAnalysis.id);
        await processProfileRebuild(env, {
          jobId: profile.profileJobId,
          ownerUserId: owner,
          desiredGeneration: profile.freshness.desiredGeneration,
        });
        const selections = db.database
          .prepare(
            `SELECT i.id,i.item_type FROM profile_snapshot_items i JOIN profile_snapshots s ON s.id=i.profile_snapshot_id WHERE i.analysis_domain=? AND s.profile_generation=? ORDER BY i.ordinal LIMIT 8`,
          )
          .all(fixture.domain, profile.freshness.desiredGeneration);
        const selectedItemIds = selections
          .filter((row) => row.item_type !== "negative_preference")
          .map((row) => row.id as string);
        if (selectedItemIds.length) {
          const request = await createGenerationRequest(
            env,
            owner,
            fixture.domain,
            generationRequestInputSchema.parse({
              mode: "faithful",
              purpose: "同じ条件で独創的なオリジナルキャラクターを比較する",
              selectedItemIds,
              prohibitedItemIds: selections
                .filter((row) => row.item_type === "negative_preference")
                .map((row) => row.id as string),
            }),
            crypto.randomUUID(),
          );
          await processGeneration(env, {
            jobId: request.jobId as string,
            ownerUserId: owner,
            generationRequestId: request.generationRequestId,
            inputGeneration: 1,
            analysisDomain: fixture.domain,
          });
          generation = {
            brief: db.database
              .prepare(
                `SELECT brief_json FROM generation_briefs WHERE generation_request_id=? ORDER BY revision_number DESC LIMIT 1`,
              )
              .get(request.generationRequestId),
            result: (await listGenerations(env, owner, fixture.domain))[0],
            inspections: db.database
              .prepare(
                `SELECT ordinal,status,character_json,validation_json,similarity_json,comparison_json FROM generation_candidates WHERE generation_request_id=? ORDER BY ordinal`,
              )
              .all(request.generationRequestId),
          };
        }
      }
      const assertions = db.database
        .prepare(
          "SELECT response_channel,polarity,context_json,explicitness FROM preference_assertions WHERE owner_user_id=?",
        )
        .all(owner);
      const modelRuns = db.database
        .prepare(
          "SELECT operation,requested_model,resolved_model,prompt_hash,input_hash,output_hash,input_token_estimate,output_token_estimate,latency_ms FROM model_run_metadata WHERE owner_user_id=?",
        )
        .all(owner);
      results.push({
        id: fixture.id,
        domain: fixture.domain,
        expectedChannels: fixture.expectedChannels,
        expectsEmpty: fixture.expectsEmpty ?? false,
        assertions,
        generation,
        detail,
        modelRuns,
      });
      console.log(`Evaluated ${fixture.id}`);
    } catch (error) {
      const jobs = db.database
        .prepare("SELECT status,error_code,error_detail_safe FROM jobs WHERE owner_user_id=?")
        .all(owner);
      results.push({
        id: fixture.id,
        domain: fixture.domain,
        error: error instanceof Error ? error.message : "EVALUATION_FAILED",
        jobs,
      });
      console.log(`Failed ${fixture.id}`);
    } finally {
      db.close();
    }
  }
  return {
    schemaVersion: "1.0",
    fixtureVersion: QUALITY_FIXTURE_VERSION,
    provider: bindings.LLM_PROVIDER,
    model: bindings.LLM_MODEL,
    createdAt: new Date().toISOString(),
    results,
  };
}
