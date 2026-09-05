import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { darkScopeReviewRequestSchema } from "../../shared/contracts/dark-understanding";
import {
  darkEntryReanalysisSchema,
  darkEntrySubmissionSchema,
  entryReanalysisSchema,
  entrySubmissionSchema,
  identityCandidateRequestSchema,
} from "../../shared/contracts/entries";
import {
  entryCreationSchema,
  entryListSchema,
  entryReanalysisResultSchema,
  identityCandidatesSchema,
  preferenceActivationSchema,
  preferenceMutationResultSchema,
  refinementResultSchema,
  scopeReviewResultSchema,
  understandingConfirmationSchema,
  understandingMutationResultSchema,
} from "../../shared/contracts/entries-response";
import { reviewDetailSchema } from "../../shared/contracts/entry-review";
import { preferenceRefinementSchema } from "../../shared/contracts/refinement";
import { preferenceReviewRequestSchema, understandingReviewRequestSchema } from "../../shared/contracts/reviews";
import { requireSession } from "../auth";
import { activateAnalysisAndRebuild } from "../features/analysis/activation";
import { archiveEntry } from "../features/entries/archive";
import { createEntry } from "../features/entries/create";
import { listIdentityCandidates } from "../features/entries/identity";
import { listEntries } from "../features/entries/list";
import { moderateEntryDraft } from "../features/entries/moderation";
import { mutatePreferenceReview, rejectPreferenceAnalysisItem } from "../features/entries/preference-review";
import { createEntryReanalysis } from "../features/entries/reanalysis";
import { refinePreferenceInput } from "../features/entries/refinement";
import { loadEntryReview } from "../features/entries/review";
import { reviewDarkScopeAssessment } from "../features/entries/scope-review";
import { confirmUnderstanding, mutateUnderstandingReview } from "../features/entries/understanding-review";
import {
  createApiRouter,
  data,
  dispatchAfterCommit,
  errorResponses,
  jsonResponse,
  requireAllowed,
  requireIdempotencyKey,
} from "../http";
import { createModerationProvider } from "../moderation/providers";

export function createEntriesRoutes(domain: AnalysisDomain) {
  const app = createApiRouter();
  const submissionSchema = domain === "dark" ? darkEntrySubmissionSchema : entrySubmissionSchema;
  const reanalysisSchema = domain === "dark" ? darkEntryReanalysisSchema : entryReanalysisSchema;
  const notFoundMessage = domain === "dark" ? "ダークキャラクターが見つかりません" : "キャラクターが見つかりません";

  app.openapi(
    createRoute({
      method: "get",
      path: "/entries",
      operationId: domain + "." + "entries.get..entries",
      request: {},
      responses: { ...errorResponses, 200: jsonResponse(entryListSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      return context.json(
        data({ entries: await listEntries(context.env, session.userId, domain) }, entryListSchema),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/identity-candidates",
      operationId: domain + "." + "entries.post..identity.candidates",
      request: {
        body: { required: true, content: { "application/json": { schema: identityCandidateRequestSchema } } },
      },
      responses: { ...errorResponses, 200: jsonResponse(identityCandidatesSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const candidates = await listIdentityCandidates(context.env, session.userId, domain, context.req.valid("json"));
      return context.json(data({ candidates }, identityCandidatesSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/entries",
      operationId: domain + "." + "entries.post..entries",
      request: { body: { required: true, content: { "application/json": { schema: submissionSchema } } } },
      responses: { ...errorResponses, 202: jsonResponse(entryCreationSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      await requireAllowed(moderateEntryDraft(context.env, context.req.valid("json")));
      const result = await createEntry(
        context.env,
        session.userId,
        domain,
        context.req.valid("json"),
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
      if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
      return context.json(data(result, entryCreationSchema), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/entries/{id}",
      operationId: domain + "." + "entries.get..entries.id",
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { ...errorResponses, 200: jsonResponse(reviewDetailSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      const result = await loadEntryReview(context.env, session.userId, domain, context.req.param("id"));
      if (!result) throw new HTTPException(404, { message: notFoundMessage });
      return context.json(data(result, reviewDetailSchema), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/entries/{id}/reanalysis",
      operationId: domain + "." + "entries.post..entries.id.reanalysis",
      request: {
        body: { required: true, content: { "application/json": { schema: reanalysisSchema } } },
        params: z.object({ id: z.string().min(1) }),
      },
      responses: { ...errorResponses, 202: jsonResponse(entryReanalysisResultSchema) },
    }),
    async (context) => {
      const session = requireSession(context);
      await requireAllowed(moderateEntryDraft(context.env, context.req.valid("json").draft));
      const result = await createEntryReanalysis(
        context.env,
        session.userId,
        domain,
        context.req.param("id"),
        context.req.valid("json"),
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      if (!result.replayed) dispatchAfterCommit(context, result.outboxEventId);
      if (!result.replayed) dispatchAfterCommit(context, result.profileOutboxEventId);
      return context.json(data(result, entryReanalysisResultSchema), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/understanding-snapshots/{snapshotId}/review",
      operationId: domain + "." + "entries.post..understanding.snapshots.snapshotId.review",
      request: {
        body: { required: true, content: { "application/json": { schema: understandingReviewRequestSchema } } },
        params: z.object({ snapshotId: z.string().min(1) }),
      },
      responses: {
        ...errorResponses,
        200: jsonResponse(understandingMutationResultSchema),
        202: jsonResponse(understandingConfirmationSchema),
      },
    }),
    async (context) => {
      const session = requireSession(context);
      const input = context.req.valid("json");
      const snapshotId = context.req.param("snapshotId");
      if ("action" in input) {
        const result = await mutateUnderstandingReview(
          context.env,
          session.userId,
          domain,
          snapshotId,
          input,
          requireIdempotencyKey(context.req.header("Idempotency-Key")),
        );
        return context.json(data(result, understandingMutationResultSchema), 200);
      }
      if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== snapshotId)
        throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
      const result = await confirmUnderstanding(context.env, session.userId, domain, input.targetIds[0]);
      dispatchAfterCommit(context, result.outboxEventId);
      return context.json(
        data({ entryId: result.entryId, status: "analyzing", jobId: result.jobId }, understandingConfirmationSchema),
        202,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/preference-analysis-runs/{runId}/review",
      operationId: domain + "." + "entries.post..preference.analysis.runs.runId.review",
      request: {
        body: { required: true, content: { "application/json": { schema: preferenceReviewRequestSchema } } },
        params: z.object({ runId: z.string().min(1) }),
      },
      responses: {
        ...errorResponses,
        200: jsonResponse(preferenceMutationResultSchema),
        202: jsonResponse(preferenceActivationSchema),
      },
    }),
    async (context) => {
      const session = requireSession(context);
      const input = context.req.valid("json");
      const runId = context.req.param("runId");
      if ("action" in input) {
        const result = await mutatePreferenceReview(
          context.env,
          session.userId,
          domain,
          runId,
          input,
          requireIdempotencyKey(context.req.header("Idempotency-Key")),
        );
        return context.json(data(result, preferenceMutationResultSchema), 200);
      }
      if (input.decision === "reject_selected") {
        if (input.targetIds.length !== 1)
          throw new HTTPException(422, { message: "削除する好みの候補を1件選択してください" });
        const result = await rejectPreferenceAnalysisItem(
          context.env,
          session.userId,
          domain,
          runId,
          input.targetIds[0],
        );
        return context.json(data(result, preferenceMutationResultSchema), 200);
      }
      if (input.decision !== "confirm_all" || input.targetIds.length !== 1 || input.targetIds[0] !== runId)
        throw new HTTPException(422, { message: "現在は全体確認を選択してください" });
      const result = await activateAnalysisAndRebuild(context.env, session.userId, domain, input.targetIds[0]);
      dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data({ status: "active", ...result }, preferenceActivationSchema), 202);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/entries/{id}",
      operationId: domain + "." + "entries.delete..entries.id",
      request: { params: z.object({ id: z.string().min(1) }) },
      responses: { ...errorResponses, 204: { description: "No content" } },
    }),
    async (context) => {
      const session = requireSession(context);
      try {
        const result = await archiveEntry(context.env, session.userId, domain, context.req.param("id"));
        dispatchAfterCommit(context, result.outboxEventId);
      } catch (error) {
        if (error instanceof Error && error.message === "ENTRY_NOT_FOUND")
          throw new HTTPException(404, { message: notFoundMessage });
        throw error;
      }
      return context.body(null, 204);
    },
  );

  if (domain === "dark") {
    app.openapi(
      createRoute({
        method: "post",
        path: "/scope-assessments/{assessmentId}/review",
        operationId: domain + "." + "entries.post..scope.assessments.assessmentId.review",
        request: {
          body: { required: true, content: { "application/json": { schema: darkScopeReviewRequestSchema } } },
          params: z.object({ assessmentId: z.string().min(1) }),
        },
        responses: {
          ...errorResponses,
          200: jsonResponse(scopeReviewResultSchema),
          202: jsonResponse(scopeReviewResultSchema),
        },
      }),
      async (context) => {
        const session = requireSession(context);
        const result = await reviewDarkScopeAssessment(
          context.env,
          session.userId,
          context.req.param("assessmentId"),
          context.req.valid("json"),
        );
        if (result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
        return context.json(data(result, scopeReviewResultSchema), result.status === "queued" ? 202 : 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/entries/{id}/preference-input",
      operationId: domain + "." + "entries.post..entries.id.preference.input",
      request: {
        body: { required: true, content: { "application/json": { schema: preferenceRefinementSchema } } },
        params: z.object({ id: z.string().min(1) }),
      },
      responses: { ...errorResponses, 202: jsonResponse(refinementResultSchema) },
    }),
    async (context) => {
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
      const result = await refinePreferenceInput(
        context.env,
        requireSession(context).userId,
        domain,
        context.req.param("id"),
        input,
        requireIdempotencyKey(context.req.header("Idempotency-Key")),
      );
      if (!result.replayed && result.outboxEventId) dispatchAfterCommit(context, result.outboxEventId);
      return context.json(data(result, refinementResultSchema), 202);
    },
  );
  return app;
}
