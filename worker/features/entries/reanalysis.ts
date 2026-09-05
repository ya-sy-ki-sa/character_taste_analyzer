import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { type AnyEntryReanalysisInput, anyEntryDraftSchema } from "../../../shared/contracts/entries";
import {
  entryBaseCharacterName,
  entryInputSources,
  entryReferenceMaterial,
  entryScopeText,
} from "../../../shared/entry-input";
import { deriveUuid, normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { newJobLlmRoutingJson } from "../../llm/execution";
import { outboxStatement } from "../../platform/outbox/write";
import { prepareQuotaReservation } from "../../platform/quota/reservations";
import type { Env } from "../../types";
import { registrationTitle } from "./presentation";
import * as repository from "./repositories/reanalysis";
import type { ReanalyzedEntry } from "./types";

export async function createEntryReanalysis(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  entryId: string,
  input: AnyEntryReanalysisInput,
  idempotencyKey: string,
): Promise<ReanalyzedEntry> {
  const current = await first<{
    status: string;
    active_revision_number: number;
    representation_id: string;
    source_set_id: string | null;
    character_identity_id: string;
    work_id: string | null;
    preference_context: string | null;
    user_character_view: string | null;
    registration_payload_json: string;
  }>(repository.selectUserCharacterEntries(env.DB, [entryId, ownerUserId, analysisDomain]));
  if (!current) throw new Error("ENTRY_NOT_FOUND");

  const previousDraft = anyEntryDraftSchema.parse(JSON.parse(current.registration_payload_json));
  const nextDraft = input.draft;
  if (nextDraft.registrationType !== previousDraft.registrationType)
    throw new Error("ENTRY_REGISTRATION_TYPE_IMMUTABLE");
  const payloadJson = JSON.stringify(nextDraft);
  const contentHash = await sha256Hex(payloadJson);
  const revisionId = await deriveUuid(
    env.AUTH_PEPPER,
    `entry-reanalysis:revision:${ownerUserId}:${entryId}:${idempotencyKey}`,
  );
  const jobId = await deriveUuid(env.AUTH_PEPPER, `entry-reanalysis:job:${ownerUserId}:${entryId}:${idempotencyKey}`);
  const replay = await first<{ revision_number: number; content_hash: string; job_id: string | null }>(
    repository.selectJobs(env.DB, [ownerUserId, revisionId, entryId]),
  );
  if (replay) {
    if (replay.content_hash !== contentHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    if (!replay.job_id) throw new Error("ANALYSIS_JOB_NOT_FOUND");
    return {
      entryId,
      entryRevisionId: revisionId,
      revisionNumber: replay.revision_number,
      jobId: replay.job_id,
      status: current.status,
      replayed: true,
    };
  }
  if (["submitted", "understanding", "analyzing"].includes(current.status))
    throw new Error("ENTRY_ANALYSIS_IN_PROGRESS");
  if (!["understanding_review", "analysis_review", "active", "failed"].includes(current.status))
    throw new Error("ENTRY_REANALYSIS_UNAVAILABLE");

  const revisionNumber = current.active_revision_number + 1;
  const now = nowIso();
  const preparationStatements: D1PreparedStatement[] = [];
  const previousBaseCharacterName = entryBaseCharacterName(previousDraft);
  const nextBaseCharacterName = entryBaseCharacterName(nextDraft);
  const identityChanged =
    normalizeIdentityPart(nextBaseCharacterName) !== normalizeIdentityPart(previousBaseCharacterName) ||
    (nextDraft.registrationType !== "original" &&
      previousDraft.registrationType !== "original" &&
      normalizeIdentityPart(nextDraft.workTitle) !== normalizeIdentityPart(previousDraft.workTitle));
  let identityId = current.character_identity_id;
  let workId = current.work_id;
  if (identityChanged) {
    if (nextDraft.registrationType !== "original" && nextDraft.identityResolution.mode === "reuse") {
      const reusable = await first<{ identity_id: string; work_id: string | null }>(
        repository.selectCharacterIdentities(env.DB, [
          nextDraft.identityResolution.characterIdentityId,
          ownerUserId,
          analysisDomain,
          normalizeIdentityPart(nextBaseCharacterName),
          nextDraft.identityResolution.workId,
          nextDraft.identityResolution.workId,
          normalizeIdentityPart(nextDraft.workTitle),
        ]),
      );
      if (!reusable) throw new Error("IDENTITY_RESOLUTION_INVALID");
      identityId = reusable.identity_id;
      workId = reusable.work_id;
    } else {
      identityId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:identity`);
      workId =
        nextDraft.registrationType === "original" ? null : await deriveUuid(env.AUTH_PEPPER, `${revisionId}:work`);
      if (nextDraft.registrationType !== "original" && workId) {
        preparationStatements.push(
          repository.insertWorks(env.DB, [
            workId,
            ownerUserId,
            nextDraft.workTitle,
            normalizeIdentityPart(nextDraft.workTitle),
            nextDraft.mediaType ?? null,
            now,
            now,
            analysisDomain,
          ]),
        );
      }
      preparationStatements.push(
        repository.insertCharacterIdentities(env.DB, [
          identityId,
          nextDraft.registrationType === "original" ? "original" : "existing",
          ownerUserId,
          workId,
          nextBaseCharacterName,
          normalizeIdentityPart(nextBaseCharacterName),
          now,
          now,
          analysisDomain,
        ]),
      );
    }
  }

  const representationId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:representation`);
  const baseRepresentationId =
    nextDraft.registrationType === "customized_existing"
      ? await deriveUuid(env.AUTH_PEPPER, `${revisionId}:base-representation`)
      : null;
  const referenceMaterial = entryReferenceMaterial(nextDraft);
  if (baseRepresentationId && nextDraft.registrationType === "customized_existing")
    preparationStatements.push(
      repository.insertCharacterRepresentations(env.DB, [
        baseRepresentationId,
        identityId,
        ownerUserId,
        `基本像: ${nextDraft.workTitle} / ${nextBaseCharacterName}`,
        referenceMaterial?.slice(0, 2000) ?? null,
        now,
        now,
      ]),
    );
  const representationType =
    nextDraft.registrationType === "original"
      ? "original"
      : nextDraft.registrationType === "customized_existing"
        ? nextDraft.representationType
        : "canonical_whole";
  const canonicality =
    nextDraft.registrationType === "original"
      ? "original"
      : nextDraft.registrationType === "customized_existing"
        ? nextDraft.representationType === "transformative" || nextDraft.representationType === "alternate_setting"
          ? "transformative"
          : "user_interpretation"
        : "official";
  const scopeType =
    nextDraft.registrationType === "customized_existing"
      ? nextDraft.representationType === "scene_state"
        ? "scene"
        : nextDraft.representationType === "facet"
          ? "facet"
          : nextDraft.representationType === "alternate_setting"
            ? "alternate_setting"
            : "whole"
      : "whole";
  preparationStatements.push(
    repository.insertCharacterRepresentations2(env.DB, [
      representationId,
      identityId,
      baseRepresentationId,
      ownerUserId,
      representationType,
      canonicality,
      scopeType,
      entryScopeText(nextDraft),
      nextDraft.registrationType === "customized_existing" ? nextDraft.customizationDescription : null,
      (nextDraft.registrationType === "original" ? nextDraft.characterBasicInfo : referenceMaterial)?.slice(0, 2000) ??
        null,
      now,
      now,
    ]),
  );

  const sourceSetId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:source-set`);
  const sources = entryInputSources(nextDraft);
  const sourceSetHash = await sha256Hex(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text }))));
  preparationStatements.push(repository.insertSourceSets(env.DB, [sourceSetId, ownerUserId, sourceSetHash, now, now]));
  for (const [ordinal, source] of sources.entries()) {
    const documentId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:source-document:${ordinal}`);
    const hash = await sha256Hex(source.text);
    preparationStatements.push(
      repository.insertSources(env.DB, [
        documentId,
        ownerUserId,
        `${registrationTitle(nextDraft)} ${source.label}`,
        JSON.stringify({ inputPointer: source.pointer }),
        new TextEncoder().encode(source.text).byteLength,
        hash,
        JSON.stringify({ type: "json_pointer", pointer: source.pointer }),
        source.text,
        Math.ceil(source.text.length / 3),
        now,
        now,
      ]),
      repository.insertSourceSetItems(env.DB, [sourceSetId, documentId, ordinal + 1]),
    );
  }
  const quota = await prepareQuotaReservation(env, ownerUserId, "analysis", idempotencyKey, contentHash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    {
      type: "analysis.start",
      params: { jobId, ownerUserId, entryId, stage: "understanding", inputGeneration: revisionNumber, analysisDomain },
    },
    `analysis:${jobId}:${revisionNumber}:understanding`,
    idempotencyKey,
  );
  const projectionState =
    current.status === "active"
      ? await first<{ desired_generation: number; built_generation: number }>(
          repository.selectProjectionRebuildStates(env.DB, [ownerUserId]),
        )
      : null;
  const desiredGeneration = (projectionState?.desired_generation ?? 0) + 1;
  const profileJobId = crypto.randomUUID();
  const profileOutbox =
    current.status === "active"
      ? await outboxStatement(
          env,
          ownerUserId,
          "job",
          profileJobId,
          1,
          {
            type: "profile.rebuild",
            params: { jobId: profileJobId, ownerUserId, desiredGeneration },
          },
          `profile:${ownerUserId}:${desiredGeneration}`,
          revisionId,
        )
      : null;
  const statements: D1PreparedStatement[] = [
    ...preparationStatements,
    repository.insertEntryRevisions(env.DB, [
      revisionId,
      entryId,
      revisionNumber,
      representationId,
      sourceSetId,
      nextDraft.preferenceContext ?? null,
      nextDraft.userCharacterView ?? null,
      JSON.stringify(nextDraft.preference),
      payloadJson,
      contentHash,
      now,
    ]),
    ...quota.statements,
    repository.insertJobs(env.DB, [
      jobId,
      ownerUserId,
      entryId,
      revisionNumber,
      quota.id,
      now,
      now,
      analysisDomain,
      await newJobLlmRoutingJson(env, ownerUserId),
    ]),
    repository.updateJobs(env.DB, [now, now, ownerUserId, entryId, jobId]),
  ];
  const entryUpdateIndex = statements.length;
  statements.push(
    repository.updateUserCharacterEntries(env.DB, [
      revisionNumber,
      now,
      entryId,
      ownerUserId,
      current.active_revision_number,
    ]),
    outbox.statement,
  );
  if (profileOutbox)
    statements.push(
      repository.insertProjectionRebuildStates(env.DB, [
        ownerUserId,
        desiredGeneration,
        projectionState?.built_generation ?? 0,
        now,
      ]),
      repository.insertJobs2(env.DB, [profileJobId, ownerUserId, ownerUserId, desiredGeneration, now, now]),
      profileOutbox.statement,
    );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_REANALYSIS_FAILED");
  if (!results[entryUpdateIndex].meta.changes) throw new Error("ENTRY_REVISION_CONFLICT");
  return {
    entryId,
    entryRevisionId: revisionId,
    revisionNumber,
    jobId,
    outboxEventId: outbox.id,
    profileOutboxEventId: profileOutbox?.id,
    status: "submitted",
    replayed: false,
  };
}
