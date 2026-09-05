import type { UnderstandingReviewMutation } from "../../../shared/contracts/reviews";
import { normalizeIdentityPart } from "../../lib/crypto";
import { first } from "../../lib/db";
import type { Env } from "../../types";
import { confirmedReviewSourceStatements } from "../analysis/confirmed-understanding";
import * as repository from "./repositories/understanding-review";

export type UnderstandingMutationContext = {
  env: Env;
  ownerUserId: string;
  snapshotId: string;
  reviewId: string;
  reviewGeneration: number;
  now: string;
  changedId: string;
  correctedRawId: string;
  assertionAttribute: { id: string } | null;
  sourceSetId: string | null;
};

/** Prepare one edit, keeping the caller responsible for its single atomic commit. */
export async function prepareUnderstandingMutation(
  context: UnderstandingMutationContext,
  input: UnderstandingReviewMutation,
): Promise<D1PreparedStatement[]> {
  switch (input.action) {
    case "add_assertion":
      return addAssertionStatements(context, input);
    case "update_assertion":
      return updateAssertionStatements(context, input);
    case "delete_assertion":
      return deleteAssertionStatements(context, input);
    case "add_delta":
      return addDeltaStatements(context, input);
    case "update_delta":
      return updateDeltaStatements(context, input);
    case "delete_delta":
      return deleteDeltaStatements(context, input);
  }
}

async function addAssertionStatements(
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
    sourceSetId,
  }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "add_assertion" }>,
): Promise<D1PreparedStatement[]> {
  const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
  return [
    repository.insertReviewMention(env.DB, [
      correctedRawId,
      ownerUserId,
      changedId,
      input.rawLabel,
      input.valueText,
      normalizeIdentityPart(input.rawLabel),
      now,
    ]),
    repository.insertReviewMapping(env.DB, [
      crypto.randomUUID(),
      correctedRawId,
      assertionAttribute?.id ?? null,
      assertionAttribute ? "accepted" : "unmapped",
      ownerUserId,
      now,
      now,
    ]),
    repository.insertAddedAssertion(env.DB, [
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
    repository.recordAddedAssertion(env.DB, [
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
    ...(await confirmedReviewSourceStatements(env, ownerUserId, changedId, input.valueText, sourceSetId)),
  ];
}

async function updateAssertionStatements(
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
    sourceSetId,
  }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "update_assertion" }>,
): Promise<D1PreparedStatement[]> {
  const current = await first<{ raw_label: string; value_text: string; raw_mention_id: string | null }>(
    repository.selectEditableAssertion(env.DB, [input.targetId, ownerUserId, snapshotId]),
  );
  if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
  const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
  return [
    ...(current.raw_mention_id
      ? [repository.rejectPreviousMapping(env.DB, [ownerUserId, now, current.raw_mention_id])]
      : []),
    repository.insertReviewMention(env.DB, [
      correctedRawId,
      ownerUserId,
      changedId,
      input.rawLabel,
      input.valueText,
      normalizeIdentityPart(input.rawLabel),
      now,
    ]),
    repository.insertReviewMapping(env.DB, [
      crypto.randomUUID(),
      correctedRawId,
      assertionAttribute?.id ?? null,
      assertionAttribute ? "accepted" : "unmapped",
      ownerUserId,
      now,
      now,
    ]),
    repository.insertReplacementAssertion(env.DB, [
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
    repository.supersedeAssertion(env.DB, [changedId, input.targetId, ownerUserId, snapshotId]),
    repository.recordReplacedAssertion(env.DB, [
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
    ...(await confirmedReviewSourceStatements(env, ownerUserId, changedId, input.valueText, sourceSetId)),
  ];
}

function deleteAssertionStatements(
  { env, ownerUserId, snapshotId, reviewId, reviewGeneration, now, changedId }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "delete_assertion" }>,
): D1PreparedStatement[] {
  const correction = JSON.stringify({ action: input.action, changedId });
  return [
    repository.rejectAssertion(env.DB, [input.targetId, ownerUserId, snapshotId]),
    repository.recordRejectedAssertion(env.DB, [
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
  ];
}

function addDeltaStatements(
  { env, ownerUserId, snapshotId, reviewId, reviewGeneration, now, changedId }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "add_delta" }>,
): D1PreparedStatement[] {
  if (input.operation === "remove") throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
  const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
  return [
    repository.insertAddedDelta(env.DB, [
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
    repository.recordAddedDelta(env.DB, [
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
  ];
}

async function updateDeltaStatements(
  { env, ownerUserId, snapshotId, reviewId, reviewGeneration, now, changedId }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "update_delta" }>,
): Promise<D1PreparedStatement[]> {
  const current = await first<{
    base_assertion_id: string | null;
    operation: string;
    before_value: string | null;
    after_value: string | null;
    reason_text: string | null;
  }>(repository.selectEditableDelta(env.DB, [input.targetId, ownerUserId, snapshotId]));
  if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
  if (input.operation === "remove" && !current.base_assertion_id)
    throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
  const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
  return [
    repository.updateDelta(env.DB, [
      input.operation,
      input.beforeValue,
      input.afterValue,
      input.reasonText,
      input.targetId,
      ownerUserId,
      snapshotId,
    ]),
    repository.recordUpdatedDelta(env.DB, [
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
  ];
}

function deleteDeltaStatements(
  { env, ownerUserId, snapshotId, reviewId, reviewGeneration, now, changedId }: UnderstandingMutationContext,
  input: Extract<UnderstandingReviewMutation, { action: "delete_delta" }>,
): D1PreparedStatement[] {
  const correction = JSON.stringify({ action: input.action, changedId });
  return [
    repository.rejectDelta(env.DB, [input.targetId, ownerUserId, snapshotId]),
    repository.recordRejectedDelta(env.DB, [
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
  ];
}
