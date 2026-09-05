import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { UnderstandingReviewMutation } from "../../../shared/contracts/reviews";
import { deriveUuid, nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import * as repository from "./repositories/understanding-review";
import { prepareUnderstandingMutation } from "./understanding-mutations";

export async function mutateUnderstandingReview(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  snapshotId: string,
  input: UnderstandingReviewMutation,
  idempotencyKey: string,
): Promise<{
  snapshotId: string;
  changedId: string;
  action: UnderstandingReviewMutation["action"];
  replayed: boolean;
}> {
  const reviewId = await deriveUuid(
    env.AUTH_PEPPER,
    `understanding-review:${ownerUserId}:${snapshotId}:${idempotencyKey}`,
  );
  const prior = await first<{ correction_payload_json: string | null }>(
    repository.selectPriorMutation(env.DB, [reviewId, ownerUserId, snapshotId]),
  );
  if (prior) {
    const payload = prior.correction_payload_json
      ? (JSON.parse(prior.correction_payload_json) as { changedId?: string })
      : {};
    return {
      snapshotId,
      changedId: payload.changedId ?? ("targetId" in input ? input.targetId : snapshotId),
      action: input.action,
      replayed: true,
    };
  }

  const context = await first<{ id: string; source_set_id: string | null }>(
    repository.selectEditableSnapshot(env.DB, [snapshotId, ownerUserId, ownerUserId, analysisDomain]),
  );
  if (!context) throw new Error("UNDERSTANDING_REVIEW_NOT_FOUND");
  const generation = await first<{ value: number }>(repository.selectNextReviewGeneration(env.DB, [snapshotId]));
  const reviewGeneration = generation?.value ?? 1;
  const now = nowIso();
  const changedId =
    input.action === "add_assertion" || input.action === "add_delta" || input.action === "update_assertion"
      ? await deriveUuid(env.AUTH_PEPPER, `${reviewId}:changed`)
      : input.targetId;
  const assertionAttributeKey =
    input.action === "add_assertion" || input.action === "update_assertion" ? input.attributeStableKey : null;
  const assertionAttribute = assertionAttributeKey
    ? await first<{ id: string }>(repository.selectActiveAttribute(env.DB, [assertionAttributeKey, analysisDomain]))
    : null;
  if (assertionAttributeKey && !assertionAttribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
  const correctedRawId = await deriveUuid(env.AUTH_PEPPER, `${reviewId}:raw`);

  const statements = await prepareUnderstandingMutation(
    {
      env,
      ownerUserId,
      snapshotId,
      reviewId,
      reviewGeneration,
      now,
      changedId,
      correctedRawId,
      assertionAttribute,
      sourceSetId: context.source_set_id,
    },
    input,
  );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
    throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  return { snapshotId, changedId, action: input.action, replayed: false };
}

export async function confirmUnderstanding(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  snapshotId: string,
): Promise<{ entryId: string; jobId: string; inputGeneration: number; outboxEventId: string }> {
  const target = await first<{
    id: string;
    base_snapshot_id: string | null;
    entry_id: string;
    revision_number: number;
    job_id: string;
  }>(repository.selectSnapshotConfirmationContext(env.DB, [snapshotId, ownerUserId, ownerUserId, analysisDomain]));
  if (!target) throw new Error("UNDERSTANDING_REVIEW_NOT_FOUND");
  const now = nowIso();
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    target.job_id,
    2,
    {
      type: "analysis.start",
      params: {
        jobId: target.job_id,
        ownerUserId,
        entryId: target.entry_id,
        stage: "preference",
        inputGeneration: target.revision_number,
        analysisDomain,
      },
    },
    `analysis:${target.job_id}:${target.revision_number}:preference`,
    snapshotId,
  );
  const reviewStatements: D1PreparedStatement[] = [
    repository.recordSnapshotConfirmation(env.DB, [crypto.randomUUID(), ownerUserId, snapshotId, snapshotId, now]),
    repository.confirmSnapshot(env.DB, [snapshotId, ownerUserId]),
    repository.confirmProposedAssertions(env.DB, [snapshotId]),
    repository.confirmProposedDeltas(env.DB, [snapshotId]),
    repository.markEntryAnalyzing(env.DB, [now, target.entry_id, ownerUserId]),
    repository.queuePreferenceAnalysis(env.DB, [
      now,
      target.job_id,
      ownerUserId,
      target.entry_id,
      target.revision_number,
    ]),
    outbox.statement,
  ];
  if (target.base_snapshot_id) {
    reviewStatements.push(
      repository.recordSnapshotConfirmation(env.DB, [
        crypto.randomUUID(),
        ownerUserId,
        target.base_snapshot_id,
        target.base_snapshot_id,
        now,
      ]),
      repository.confirmSnapshot(env.DB, [target.base_snapshot_id, ownerUserId]),
      repository.confirmProposedAssertions(env.DB, [target.base_snapshot_id]),
    );
  }
  const results = await env.DB.batch(reviewStatements);
  if (results.some((result) => !result.success)) throw new Error("D1_UNDERSTANDING_CONFIRM_FAILED");
  if (!results[1].meta.changes || !results[4].meta.changes || !results[5].meta.changes)
    throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  return {
    entryId: target.entry_id,
    jobId: target.job_id,
    inputGeneration: target.revision_number,
    outboxEventId: outbox.id,
  };
}
