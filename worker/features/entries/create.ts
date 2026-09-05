import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyEntrySubmission } from "../../../shared/contracts/entries";
import {
  entryBaseCharacterName,
  entryInputSources,
  entryReferenceMaterial,
  entryScopeText,
} from "../../../shared/entry-input";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../../lib/crypto";
import { first } from "../../lib/db";
import { newJobLlmRoutingJson } from "../../llm/execution";
import { outboxStatement } from "../../platform/outbox/write";
import { prepareQuotaReservation } from "../../platform/quota/reservations";
import type { Env } from "../../types";
import { registrationTitle } from "./presentation";
import * as repository from "./repositories/create";
import type { CreatedEntry } from "./types";

export async function createEntry(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  draft: AnyEntrySubmission,
  idempotencyKey: string,
): Promise<CreatedEntry> {
  const seed = await sha256Hex(`${ownerUserId}\u0000${idempotencyKey}`);
  const payloadJson = JSON.stringify(draft);
  const payloadHash = await sha256Hex(payloadJson);
  const existing = await first<{ id: string; job_id: string; status: string; content_hash: string }>(
    repository.selectUserCharacterEntries(env.DB, [ownerUserId, analysisDomain, seed]),
  );
  if (existing) {
    if (existing.content_hash !== payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { entryId: existing.id, jobId: existing.job_id, status: existing.status, replayed: true };
  }

  const now = nowIso();
  const entryId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const representationId = crypto.randomUUID();
  const baseRepresentationId = draft.registrationType === "customized_existing" ? crypto.randomUUID() : null;
  const sourceSetId = crypto.randomUUID();
  let identityId: string = crypto.randomUUID();
  let workId: string | null = draft.registrationType === "original" ? null : crypto.randomUUID();
  const resolution = draft.registrationType === "original" ? { mode: "new" as const } : draft.identityResolution;
  const baseCharacterName = entryBaseCharacterName(draft);
  const statements: D1PreparedStatement[] = [];

  if (resolution.mode === "reuse") {
    const reusable = await first<{ identity_id: string; work_id: string | null }>(
      repository.selectCharacterIdentities(env.DB, [
        resolution.characterIdentityId,
        ownerUserId,
        analysisDomain,
        normalizeIdentityPart(baseCharacterName),
        resolution.workId,
        resolution.workId,
        normalizeIdentityPart(draft.registrationType === "original" ? "" : draft.workTitle),
      ]),
    );
    if (!reusable) throw new Error("IDENTITY_RESOLUTION_INVALID");
    identityId = reusable.identity_id;
    workId = reusable.work_id;
  } else {
    if (draft.registrationType !== "original" && workId) {
      statements.push(
        repository.insertWorks(env.DB, [
          workId,
          ownerUserId,
          draft.workTitle,
          normalizeIdentityPart(draft.workTitle),
          draft.mediaType ?? null,
          now,
          now,
          analysisDomain,
        ]),
      );
    }
    statements.push(
      repository.insertCharacterIdentities(env.DB, [
        identityId,
        draft.registrationType === "original" ? "original" : "existing",
        ownerUserId,
        workId,
        baseCharacterName,
        normalizeIdentityPart(baseCharacterName),
        now,
        now,
        analysisDomain,
      ]),
    );
  }

  const referenceMaterial = entryReferenceMaterial(draft);
  if (baseRepresentationId && draft.registrationType === "customized_existing")
    statements.push(
      repository.insertCharacterRepresentations(env.DB, [
        baseRepresentationId,
        identityId,
        ownerUserId,
        `基本像: ${draft.workTitle} / ${baseCharacterName}`,
        referenceMaterial?.slice(0, 2000) ?? null,
        now,
        now,
      ]),
    );
  const representationType =
    draft.registrationType === "original"
      ? "original"
      : draft.registrationType === "customized_existing"
        ? draft.representationType
        : "canonical_whole";
  const canonicality =
    draft.registrationType === "original"
      ? "original"
      : draft.registrationType === "customized_existing"
        ? draft.representationType === "transformative" || draft.representationType === "alternate_setting"
          ? "transformative"
          : "user_interpretation"
        : "official";
  const scopeType =
    draft.registrationType === "customized_existing"
      ? draft.representationType === "scene_state"
        ? "scene"
        : draft.representationType === "facet"
          ? "facet"
          : draft.representationType === "alternate_setting"
            ? "alternate_setting"
            : "whole"
      : "whole";
  statements.push(
    repository.insertCharacterRepresentations2(env.DB, [
      representationId,
      identityId,
      baseRepresentationId,
      ownerUserId,
      representationType,
      canonicality,
      scopeType,
      entryScopeText(draft),
      draft.registrationType === "customized_existing" ? draft.customizationDescription : null,
      (draft.registrationType === "original" ? draft.characterBasicInfo : referenceMaterial)?.slice(0, 2000) ?? null,
      now,
      now,
    ]),
  );

  const sources = entryInputSources(draft);
  const sourceSetHash = await sha256Hex(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text }))));
  statements.push(repository.insertSourceSets(env.DB, [sourceSetId, ownerUserId, sourceSetHash, now, now]));
  for (const [ordinal, source] of sources.entries()) {
    const documentId = crypto.randomUUID();
    const hash = await sha256Hex(source.text);
    statements.push(
      repository.insertSources(env.DB, [
        documentId,
        ownerUserId,
        `${registrationTitle(draft)} ${source.label}`,
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

  const quota = await prepareQuotaReservation(env, ownerUserId, "analysis", idempotencyKey, payloadHash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    jobId,
    1,
    {
      type: "analysis.start",
      params: { jobId, ownerUserId, entryId, stage: "understanding", inputGeneration: 1, analysisDomain },
    },
    `analysis:${jobId}:1:understanding`,
    idempotencyKey,
  );
  statements.push(
    repository.insertUserCharacterEntries(env.DB, [
      entryId,
      ownerUserId,
      draft.registrationType,
      seed,
      now,
      now,
      analysisDomain,
    ]),
    repository.insertEntryRevisions(env.DB, [
      revisionId,
      entryId,
      representationId,
      sourceSetId,
      draft.preferenceContext ?? null,
      draft.userCharacterView ?? null,
      JSON.stringify(draft.preference),
      payloadJson,
      payloadHash,
      now,
    ]),
    ...quota.statements,
    repository.insertJobs(env.DB, [
      jobId,
      ownerUserId,
      entryId,
      quota.id,
      now,
      now,
      analysisDomain,
      await newJobLlmRoutingJson(env, ownerUserId),
    ]),
    outbox.statement,
  );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_CREATE_FAILED");
  return { entryId, jobId, outboxEventId: outbox.id, status: "submitted", replayed: false };
}
