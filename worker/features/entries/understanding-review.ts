import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { UnderstandingReviewMutation } from "../../../shared/contracts/reviews";
import { deriveUuid, normalizeIdentityPart, nowIso } from "../../lib/crypto";
import { first } from "../../lib/db";
import { outboxStatement } from "../../platform/outbox/write";
import type { Env } from "../../types";
import { confirmedReviewSourceStatements } from "../analysis/confirmed-understanding";
import * as repository from "./repositories/understanding-review";

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
    repository.selectUnderstandingReviews(env.DB, [reviewId, ownerUserId, snapshotId]),
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
    repository.selectCharacterUnderstandingSnapshots(env.DB, [snapshotId, ownerUserId, ownerUserId, analysisDomain]),
  );
  if (!context) throw new Error("UNDERSTANDING_REVIEW_NOT_FOUND");
  const generation = await first<{ value: number }>(repository.selectUnderstandingReviews2(env.DB, [snapshotId]));
  const reviewGeneration = generation?.value ?? 1;
  const now = nowIso();
  const changedId =
    input.action === "add_assertion" || input.action === "add_delta" || input.action === "update_assertion"
      ? await deriveUuid(env.AUTH_PEPPER, `${reviewId}:changed`)
      : input.targetId;
  const assertionAttributeKey =
    input.action === "add_assertion" || input.action === "update_assertion" ? input.attributeStableKey : null;
  const assertionAttribute = assertionAttributeKey
    ? await first<{ id: string }>(
        repository.selectAttributeDefinitions(env.DB, [assertionAttributeKey, analysisDomain]),
      )
    : null;
  if (assertionAttributeKey && !assertionAttribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
  const correctedRawId = await deriveUuid(env.AUTH_PEPPER, `${reviewId}:raw`);

  if (input.action === "add_assertion") {
    const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
    const results = await env.DB.batch([
      repository.insertRawAttributeMentions(env.DB, [
        correctedRawId,
        ownerUserId,
        changedId,
        input.rawLabel,
        input.valueText,
        normalizeIdentityPart(input.rawLabel),
        now,
      ]),
      repository.insertAttributeMappings(env.DB, [
        crypto.randomUUID(),
        correctedRawId,
        assertionAttribute?.id ?? null,
        assertionAttribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ]),
      repository.insertCharacterAssertions(env.DB, [
        changedId,
        ownerUserId,
        snapshotId,
        assertionAttribute?.id ?? null,
        correctedRawId,
        input.rawLabel,
        input.valueText,
        JSON.stringify({ schemaVersion: "1", freeText: "ユーザーが確認画面で追加" }),
        snapshotId,
        now,
        snapshotId,
        ownerUserId,
      ]),
      repository.insertUnderstandingReviews(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        changedId,
        correction,
        reviewGeneration,
        now,
        changedId,
        ownerUserId,
        snapshotId,
      ]),
      ...(await confirmedReviewSourceStatements(env, ownerUserId, changedId, input.valueText, context.source_set_id)),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "update_assertion") {
    const current = await first<{ raw_label: string; value_text: string; raw_mention_id: string | null }>(
      repository.selectCharacterAssertions(env.DB, [input.targetId, ownerUserId, snapshotId]),
    );
    if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
    const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
    const results = await env.DB.batch([
      ...(current.raw_mention_id
        ? [repository.updateAttributeMappings(env.DB, [ownerUserId, now, current.raw_mention_id])]
        : []),
      repository.insertRawAttributeMentions2(env.DB, [
        correctedRawId,
        ownerUserId,
        changedId,
        input.rawLabel,
        input.valueText,
        normalizeIdentityPart(input.rawLabel),
        now,
      ]),
      repository.insertAttributeMappings2(env.DB, [
        crypto.randomUUID(),
        correctedRawId,
        assertionAttribute?.id ?? null,
        assertionAttribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ]),
      repository.insertCharacterAssertions2(env.DB, [
        changedId,
        assertionAttribute?.id ?? null,
        correctedRawId,
        input.rawLabel,
        input.valueText,
        now,
        input.targetId,
        ownerUserId,
        snapshotId,
      ]),
      repository.updateCharacterAssertions(env.DB, [changedId, input.targetId, ownerUserId, snapshotId]),
      repository.insertUnderstandingReviews2(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        input.targetId,
        correction,
        reviewGeneration,
        now,
        changedId,
        ownerUserId,
        snapshotId,
      ]),
      ...(await confirmedReviewSourceStatements(env, ownerUserId, changedId, input.valueText, context.source_set_id)),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "delete_assertion") {
    const correction = JSON.stringify({ action: input.action, changedId });
    const results = await env.DB.batch([
      repository.updateCharacterAssertions2(env.DB, [input.targetId, ownerUserId, snapshotId]),
      repository.insertUnderstandingReviews3(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        input.targetId,
        correction,
        reviewGeneration,
        now,
        input.targetId,
        ownerUserId,
        snapshotId,
      ]),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "add_delta") {
    if (input.operation === "remove") throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
    const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
    const results = await env.DB.batch([
      repository.insertCustomizationDeltas(env.DB, [
        changedId,
        ownerUserId,
        snapshotId,
        input.operation,
        input.beforeValue,
        input.afterValue,
        JSON.stringify({ schemaVersion: "1", freeText: "ユーザーが確認画面で追加" }),
        input.reasonText,
        snapshotId,
        now,
        snapshotId,
        ownerUserId,
      ]),
      repository.insertUnderstandingReviews4(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        changedId,
        correction,
        reviewGeneration,
        now,
        changedId,
        ownerUserId,
        snapshotId,
      ]),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "update_delta") {
    const current = await first<{
      base_assertion_id: string | null;
      operation: string;
      before_value: string | null;
      after_value: string | null;
      reason_text: string | null;
    }>(repository.selectCustomizationDeltas(env.DB, [input.targetId, ownerUserId, snapshotId]));
    if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
    if (input.operation === "remove" && !current.base_assertion_id)
      throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
    const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
    const results = await env.DB.batch([
      repository.updateCustomizationDeltas(env.DB, [
        input.operation,
        input.beforeValue,
        input.afterValue,
        input.reasonText,
        input.targetId,
        ownerUserId,
        snapshotId,
      ]),
      repository.insertUnderstandingReviews5(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        input.targetId,
        correction,
        reviewGeneration,
        now,
        input.targetId,
        ownerUserId,
        snapshotId,
      ]),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else {
    const correction = JSON.stringify({ action: input.action, changedId });
    const results = await env.DB.batch([
      repository.updateCustomizationDeltas2(env.DB, [input.targetId, ownerUserId, snapshotId]),
      repository.insertUnderstandingReviews6(env.DB, [
        reviewId,
        ownerUserId,
        snapshotId,
        input.targetId,
        correction,
        reviewGeneration,
        now,
        input.targetId,
        ownerUserId,
        snapshotId,
      ]),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  }
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
  }>(repository.selectCharacterUnderstandingSnapshots2(env.DB, [snapshotId, ownerUserId, ownerUserId, analysisDomain]));
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
    repository.insertUnderstandingReviews7(env.DB, [crypto.randomUUID(), ownerUserId, snapshotId, snapshotId, now]),
    repository.updateCharacterUnderstandingSnapshots(env.DB, [snapshotId, ownerUserId]),
    repository.updateCharacterAssertions3(env.DB, [snapshotId]),
    repository.updateCustomizationDeltas3(env.DB, [snapshotId]),
    repository.updateUserCharacterEntries(env.DB, [now, target.entry_id, ownerUserId]),
    repository.updateJobs(env.DB, [now, target.job_id, ownerUserId, target.entry_id, target.revision_number]),
    outbox.statement,
  ];
  if (target.base_snapshot_id) {
    reviewStatements.push(
      repository.insertUnderstandingReviews8(env.DB, [
        crypto.randomUUID(),
        ownerUserId,
        target.base_snapshot_id,
        target.base_snapshot_id,
        now,
      ]),
      repository.updateCharacterUnderstandingSnapshots2(env.DB, [target.base_snapshot_id, ownerUserId]),
      repository.updateCharacterAssertions4(env.DB, [target.base_snapshot_id]),
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
