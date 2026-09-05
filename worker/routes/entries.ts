import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { preferenceRefinementSchema } from "../../shared/quality-schemas";
import {
  darkEntryReanalysisSchema,
  darkEntrySubmissionSchema,
  darkScopeReviewRequestSchema,
  entryReanalysisSchema,
  entrySubmissionSchema,
  identityCandidateRequestSchema,
  preferenceReviewRequestSchema,
  understandingReviewRequestSchema,
} from "../../shared/schemas";
import { requireSession } from "../auth";
import { data, dispatchAfterCommit, requireAllowed, requireIdempotencyKey, validateJson } from "../http";
import { createModerationProvider } from "../moderation/providers";
import { moderateEntryDraft } from "../services/input-moderation";
import { createDataStoreStrategy } from "../storage/strategy";
import type { AppEnv } from "../types";

export function createEntriesRoutes(domain: AnalysisDomain) {
  const app = new Hono<AppEnv>();
  const submissionSchema = domain === "dark" ? darkEntrySubmissionSchema : entrySubmissionSchema;
  const reanalysisSchema = domain === "dark" ? darkEntryReanalysisSchema : entryReanalysisSchema;
  const notFoundMessage = domain === "dark" ? "ダークキャラクターが見つかりません" : "キャラクターが見つかりません";

  app.get("/entries", async (context) => {
    const session = requireSession(context);
    return context.json(
      data({ entries: await createDataStoreStrategy(context.env).listEntries(session.userId, domain) }),
    );
  });

  app.post("/identity-candidates", validateJson(identityCandidateRequestSchema), async (context) => {
    const session = requireSession(context);
    const candidates = await createDataStoreStrategy(context.env).listIdentityCandidates(
      session.userId,
      domain,
      context.req.valid("json"),
    );
    return context.json(data({ candidates }));
  });

  app.post("/entries", validateJson(submissionSchema), async (context) => {
    const session = requireSession(context);
    await requireAllowed(moderateEntryDraft(context.env, context.req.valid("json")));
    const result = await createDataStoreStrategy(context.env).createEntry(
      session.userId,
      domain,
      context.req.valid("json"),
      requireIdempotencyKey(context.req.header("Idempotency-Key")),
    );
    if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
    if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
    return context.json(data(result), 202);
  });

  app.get("/entries/:id", async (context) => {
    const session = requireSession(context);
    const result = await createDataStoreStrategy(context.env).loadEntryReview(
      session.userId,
      domain,
      context.req.param("id"),
    );
    if (!result) throw new HTTPException(404, { message: notFoundMessage });
    return context.json(data(result));
  });

  app.post("/entries/:id/reanalysis", validateJson(reanalysisSchema), async (context) => {
    const session = requireSession(context);
    await requireAllowed(moderateEntryDraft(context.env, context.req.valid("json").draft));
    const result = await createDataStoreStrategy(context.env).createEntryReanalysis(
      session.userId,
      domain,
      context.req.param("id"),
      context.req.valid("json"),
      requireIdempotencyKey(context.req.header("Idempotency-Key")),
    );
    if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
    if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
    return context.json(data(result), 202);
  });

  app.post(
    "/understanding-snapshots/:snapshotId/review",
    validateJson(understandingReviewRequestSchema),
    async (context) => {
      const session = requireSession(context);
      const input = context.req.valid("json");
      const snapshotId = context.req.param("snapshotId");
      if ("action" in input) {
        const result = await createDataStoreStrategy(context.env).mutateUnderstandingReview(
          session.userId,
          domain,
          snapshotId,
          input,
          requireIdempotencyKey(context.req.header("Idempotency-Key")),
        );
        return context.json(data(result));
      }
      if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== snapshotId)
        throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
      const result = await createDataStoreStrategy(context.env).confirmUnderstanding(
        session.userId,
        domain,
        input.targetIds[0],
      );
      dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data({ entryId: result.entryId, status: "analyzing", jobId: result.jobId }), 202);
    },
  );

  app.post("/preference-analysis-runs/:runId/review", validateJson(preferenceReviewRequestSchema), async (context) => {
    const session = requireSession(context);
    const input = context.req.valid("json");
    const runId = context.req.param("runId");
    if ("action" in input) {
      const result = await createDataStoreStrategy(context.env).mutatePreferenceReview(
        session.userId,
        domain,
        runId,
        input,
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      return context.json(data(result));
    }
    if (input.decision === "reject_selected") {
      if (input.targetIds.length !== 1)
        throw new HTTPException(422, { message: "削除する好みの候補を1件選択してください" });
      const result = await createDataStoreStrategy(context.env).rejectPreferenceAnalysisItem(
        session.userId,
        domain,
        runId,
        input.targetIds[0],
      );
      return context.json(data(result));
    }
    if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== runId)
      throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
    const result = await createDataStoreStrategy(context.env).activateAnalysisAndRebuild(
      session.userId,
      domain,
      input.targetIds[0],
    );
    dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data({ status: "active", ...result }), 202);
  });

  app.delete("/entries/:id", async (context) => {
    const session = requireSession(context);
    try {
      const result = await createDataStoreStrategy(context.env).archiveEntry(
        session.userId,
        domain,
        context.req.param("id"),
      );
      dispatchAfterCommit(context, result.outboxEventId);
    } catch (error) {
      if (error instanceof Error && error.message === "ENTRY_NOT_FOUND")
        throw new HTTPException(404, { message: notFoundMessage });
      throw error;
    }
    return context.body(null, 204);
  });

  if (domain === "dark") {
    app.post("/scope-assessments/:assessmentId/review", validateJson(darkScopeReviewRequestSchema), async (context) => {
      const session = requireSession(context);
      const result = await createDataStoreStrategy(context.env).reviewDarkScopeAssessment(
        session.userId,
        context.req.param("assessmentId"),
        context.req.valid("json"),
      );
      if (result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data(result), result.status === "queued" ? 202 : 200);
    });
  }

  app.post("/entries/:id/preference-input", validateJson(preferenceRefinementSchema), async (context) => {
    const input = context.req.valid("json");
    if (input.mode === "questions")
      await requireAllowed(
        createModerationProvider(context.env).moderate(
          input.answers.flatMap((item) => [
            { field: "質問", text: item.question },
            { field: "追加回答", text: item.answer },
          ]),
        ),
      );
    const result = await createDataStoreStrategy(context.env).refinePreferenceInput(
      requireSession(context).userId,
      domain,
      context.req.param("id"),
      input,
      requireIdempotencyKey(context.req.header("Idempotency-Key")),
    );
    if (!result.replayed && result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
    return context.json(data(result), 202);
  });
  return app;
}
