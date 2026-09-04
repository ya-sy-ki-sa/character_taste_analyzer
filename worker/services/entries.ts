import type { AnalysisDomain } from "../../shared/analysis-domain";
import { darkResponseChannelValues } from "../../shared/dark-response-channels";
import { responseChannelValues } from "../../shared/response-channels";
import {
  type AnyEntryDraft,
  type AnyEntryReanalysisInput,
  type AnyEntrySubmission,
  anyEntryDraftSchema,
  type DarkScopeReviewRequest,
  type EntrySummary,
  entryBaseCharacterName,
  entryInputSources,
  entryReferenceMaterial,
  entryScopeText,
  type IdentityCandidate,
  type IdentityCandidateRequest,
  type PreferenceReviewMutation,
  type UnderstandingReviewMutation,
} from "../../shared/schemas";
import { deriveUuid, normalizeIdentityPart, nowIso, sha256Hex } from "../lib/crypto";
import { all, first, placeholders } from "../lib/db";
import type { Env } from "../types";
import { localizeAttributeReference, localizeUnderstandingSummary } from "./attribute-labels";
import { outboxStatement } from "./orchestration";
import { prepareQuotaReservation } from "./quota";

export type CreatedEntry = {
  entryId: string;
  jobId: string;
  outboxEventId?: string;
  profileOutboxEventId?: string;
  status: string;
  replayed: boolean;
};
export type ReanalyzedEntry = CreatedEntry & { entryRevisionId: string; revisionNumber: number };

export async function listIdentityCandidates(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  input: IdentityCandidateRequest,
): Promise<IdentityCandidate[]> {
  return all<IdentityCandidate>(
    env.DB.prepare(`
      SELECT ci.work_id AS workId,ci.id AS characterIdentityId,w.title AS workTitle,
             ci.name AS characterName,w.media_type AS mediaType,
             CASE WHEN ci.name_normalized=? AND w.title_normalized=? THEN 'exact'
                  ELSE 'work_and_character' END AS match
      FROM character_identities ci JOIN works w ON w.id=ci.work_id
      WHERE ci.owner_user_id=? AND ci.analysis_domain=? AND w.analysis_domain=?
        AND ci.name_normalized=? AND w.title_normalized=?
      ORDER BY ci.updated_at DESC,ci.id LIMIT 20
    `).bind(
      normalizeIdentityPart(input.characterName),
      normalizeIdentityPart(input.workTitle),
      ownerUserId,
      analysisDomain,
      analysisDomain,
      normalizeIdentityPart(input.characterName),
      normalizeIdentityPart(input.workTitle),
    ),
  );
}

function registrationTitle(draft: AnyEntryDraft): string {
  return draft.registrationType === "original" ? draft.characterName : `${draft.workTitle} / ${draft.characterName}`;
}

type EvidenceView = {
  id: string;
  verificationStatus: string;
  inferenceType: string;
  quote: string | null;
  inputPointer: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceProvider: string | null;
  trustReason: string | null;
  canNavigate: boolean;
};

async function loadEvidenceViews(
  env: Env,
  ownerUserId: string,
  ownerType: "character_assertion" | "preference_assertion" | "value_stance_assertion",
  ownerIds: string[],
): Promise<Map<string, EvidenceView[]>> {
  const grouped = new Map<string, EvidenceView[]>();
  for (let offset = 0; offset < ownerIds.length; offset += 90) {
    const chunk = ownerIds.slice(offset, offset + 90);
    if (!chunk.length) continue;
    const rows = await all<{
      id: string;
      owner_id: string;
      verification_status: string;
      inference_type: string;
      excerpt_text: string | null;
      user_input_path: string | null;
      title: string | null;
      citation_json: string | null;
    }>(
      env.DB.prepare(`
      SELECT ef.id,ef.owner_id,ef.verification_status,ef.inference_type,ef.excerpt_text,ef.user_input_path,
               sd.title,sd.citation_json
        FROM evidence_fragments ef LEFT JOIN sources sd ON sd.id=ef.source_id
        WHERE ef.owner_user_id=? AND ef.owner_type=? AND ef.owner_id IN (${placeholders(chunk.length)})
        ORDER BY ef.owner_id,ef.id
      `).bind(ownerUserId, ownerType, ...chunk),
    );
    for (const row of rows) {
      const citation = row.citation_json ? (JSON.parse(row.citation_json) as Record<string, unknown>) : {};
      const sourceUrl = typeof citation.url === "string" ? citation.url : null;
      const items = grouped.get(row.owner_id) ?? [];
      items.push({
        id: row.id,
        verificationStatus: row.verification_status,
        inferenceType: row.inference_type,
        quote: row.excerpt_text,
        inputPointer: row.user_input_path,
        sourceTitle: row.title,
        sourceUrl,
        sourceProvider: typeof citation.provider === "string" ? citation.provider : null,
        trustReason: typeof citation.trustReason === "string" ? citation.trustReason : null,
        canNavigate: row.verification_status === "verified_quote" && sourceUrl !== null,
      });
      grouped.set(row.owner_id, items);
    }
  }
  return grouped;
}

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
    env.DB.prepare(`
      SELECT e.id,j.id AS job_id,e.status,er.content_hash FROM user_character_entries e
      JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
      JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
      WHERE e.owner_user_id=? AND e.analysis_domain=? AND e.creation_idempotency_hash=?
      ORDER BY e.created_at DESC LIMIT 1
    `).bind(ownerUserId, analysisDomain, seed),
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
      env.DB.prepare(`
        SELECT ci.id AS identity_id,ci.work_id FROM character_identities ci LEFT JOIN works w ON w.id=ci.work_id
        WHERE ci.id=? AND ci.owner_user_id=? AND ci.analysis_domain=? AND ci.name_normalized=?
          AND (ci.work_id IS ? OR ci.work_id=?) AND (w.id IS NULL OR w.title_normalized=?)
      `).bind(
        resolution.characterIdentityId,
        ownerUserId,
        analysisDomain,
        normalizeIdentityPart(baseCharacterName),
        resolution.workId,
        resolution.workId,
        normalizeIdentityPart(draft.registrationType === "original" ? "" : draft.workTitle),
      ),
    );
    if (!reusable) throw new Error("IDENTITY_RESOLUTION_INVALID");
    identityId = reusable.identity_id;
    workId = reusable.work_id;
  } else {
    if (draft.registrationType !== "original" && workId) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO works (id,owner_user_id,title,title_normalized,media_type,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?)`,
        ).bind(
          workId,
          ownerUserId,
          draft.workTitle,
          normalizeIdentityPart(draft.workTitle),
          draft.mediaType ?? null,
          now,
          now,
          analysisDomain,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO character_identities (id,origin_type,owner_user_id,work_id,name,name_normalized,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(
        identityId,
        draft.registrationType === "original" ? "original" : "existing",
        ownerUserId,
        workId,
        baseCharacterName,
        normalizeIdentityPart(baseCharacterName),
        now,
        now,
        analysisDomain,
      ),
    );
  }

  const referenceMaterial = entryReferenceMaterial(draft);
  if (baseRepresentationId && draft.registrationType === "customized_existing")
    statements.push(
      env.DB.prepare(
        `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,NULL,?,'canonical_whole','official','whole',?,NULL,?,?,?)`,
      ).bind(
        baseRepresentationId,
        identityId,
        ownerUserId,
        `基本像: ${draft.workTitle} / ${baseCharacterName}`,
        referenceMaterial?.slice(0, 2000) ?? null,
        now,
        now,
      ),
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
    env.DB.prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
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
    ),
  );

  const sources = entryInputSources(draft);
  const sourceSetHash = await sha256Hex(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text }))));
  statements.push(
    env.DB.prepare(
      `INSERT INTO source_sets (id,owner_user_id,purpose,content_hash,created_at,updated_at) VALUES (?,?,'character_understanding',?,?,?)`,
    ).bind(sourceSetId, ownerUserId, sourceSetHash, now, now),
  );
  for (const [ordinal, source] of sources.entries()) {
    const documentId = crypto.randomUUID();
    const hash = await sha256Hex(source.text);
    statements.push(
      env.DB.prepare(
        `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,?,'user_text',?,'user_supplied','text/plain',?,?,?,?,?,?,?)`,
      ).bind(
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
      ),
      env.DB.prepare(
        `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,?,'user_definition')`,
      ).bind(sourceSetId, documentId, ordinal + 1),
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
    env.DB.prepare(
      `INSERT INTO user_character_entries (id,owner_user_id,registration_type,status,active_revision_number,active_generation,creation_idempotency_hash,revision,created_at,updated_at,analysis_domain) VALUES (?,?,?,'submitted',1,0,?,1,?,?,?)`,
    ).bind(entryId, ownerUserId, draft.registrationType, seed, now, now, analysisDomain),
    env.DB.prepare(
      `INSERT INTO entry_revisions (id,entry_id,revision_number,representation_id,source_set_id,preference_context,user_character_view,preference_input_json,registration_payload_json,content_hash,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)`,
    ).bind(
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
    ),
    ...quota.statements,
    env.DB.prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,quota_reservation_id,created_at,updated_at,analysis_domain) VALUES (?,?,'character_analysis','queued','entry',?,1,0,15,'queued',1,1,?,?,?,?)`,
    ).bind(jobId, ownerUserId, entryId, quota.id, now, now, analysisDomain),
    outbox.statement,
  );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_CREATE_FAILED");
  return { entryId, jobId, outboxEventId: outbox.id, status: "submitted", replayed: false };
}

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
  }>(
    env.DB.prepare(`
      SELECT e.status,e.active_revision_number,
        er.representation_id,er.source_set_id,er.preference_context,er.user_character_view,er.registration_payload_json,
        cr.character_identity_id,ci.work_id
      FROM user_character_entries e
      JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
      JOIN character_representations cr ON cr.id=er.representation_id
      JOIN character_identities ci ON ci.id=cr.character_identity_id
      WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=?
    `).bind(entryId, ownerUserId, analysisDomain),
  );
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
    env.DB.prepare(`
      SELECT er.revision_number,er.content_hash,
        (SELECT id FROM jobs WHERE owner_user_id=? AND target_type='entry' AND target_id=er.entry_id
          AND input_generation=er.revision_number LIMIT 1) AS job_id
      FROM entry_revisions er WHERE er.id=? AND er.entry_id=?
    `).bind(ownerUserId, revisionId, entryId),
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
        env.DB.prepare(`
          SELECT ci.id AS identity_id,ci.work_id FROM character_identities ci LEFT JOIN works w ON w.id=ci.work_id
          WHERE ci.id=? AND ci.owner_user_id=? AND ci.analysis_domain=? AND ci.name_normalized=?
            AND (ci.work_id IS ? OR ci.work_id=?) AND (w.id IS NULL OR w.title_normalized=?)
        `).bind(
          nextDraft.identityResolution.characterIdentityId,
          ownerUserId,
          analysisDomain,
          normalizeIdentityPart(nextBaseCharacterName),
          nextDraft.identityResolution.workId,
          nextDraft.identityResolution.workId,
          normalizeIdentityPart(nextDraft.workTitle),
        ),
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
          env.DB.prepare(
            `INSERT INTO works (id,owner_user_id,title,title_normalized,media_type,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?)`,
          ).bind(
            workId,
            ownerUserId,
            nextDraft.workTitle,
            normalizeIdentityPart(nextDraft.workTitle),
            nextDraft.mediaType ?? null,
            now,
            now,
            analysisDomain,
          ),
        );
      }
      preparationStatements.push(
        env.DB.prepare(
          `INSERT INTO character_identities (id,origin_type,owner_user_id,work_id,name,name_normalized,created_at,updated_at,analysis_domain) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).bind(
          identityId,
          nextDraft.registrationType === "original" ? "original" : "existing",
          ownerUserId,
          workId,
          nextBaseCharacterName,
          normalizeIdentityPart(nextBaseCharacterName),
          now,
          now,
          analysisDomain,
        ),
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
      env.DB.prepare(
        `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,NULL,?,'canonical_whole','official','whole',?,NULL,?,?,?)`,
      ).bind(
        baseRepresentationId,
        identityId,
        ownerUserId,
        `基本像: ${nextDraft.workTitle} / ${nextBaseCharacterName}`,
        referenceMaterial?.slice(0, 2000) ?? null,
        now,
        now,
      ),
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
    env.DB.prepare(
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
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
    ),
  );

  const sourceSetId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:source-set`);
  const sources = entryInputSources(nextDraft);
  const sourceSetHash = await sha256Hex(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text }))));
  preparationStatements.push(
    env.DB.prepare(
      `INSERT INTO source_sets (id,owner_user_id,purpose,content_hash,created_at,updated_at) VALUES (?,?,'character_understanding',?,?,?)`,
    ).bind(sourceSetId, ownerUserId, sourceSetHash, now, now),
  );
  for (const [ordinal, source] of sources.entries()) {
    const documentId = await deriveUuid(env.AUTH_PEPPER, `${revisionId}:source-document:${ordinal}`);
    const hash = await sha256Hex(source.text);
    preparationStatements.push(
      env.DB.prepare(
        `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) VALUES (?,?,?,'user_text',?,'user_supplied','text/plain',?,?,?,?,?,?,?)`,
      ).bind(
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
      ),
      env.DB.prepare(
        `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) VALUES (?,?,?,'user_definition')`,
      ).bind(sourceSetId, documentId, ordinal + 1),
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
          env.DB.prepare(
            `SELECT desired_generation,built_generation FROM projection_rebuild_states WHERE owner_user_id=?`,
          ).bind(ownerUserId),
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
    env.DB.prepare(
      `INSERT INTO entry_revisions
        (id,entry_id,revision_number,representation_id,source_set_id,preference_context,user_character_view,
         preference_input_json,registration_payload_json,content_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
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
    ),
    ...quota.statements,
    env.DB.prepare(
      `INSERT INTO jobs
        (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,
         current_step,retryable,revision,quota_reservation_id,created_at,updated_at,analysis_domain)
       VALUES (?,?,'character_analysis','queued','entry',?,?,0,15,'queued',1,1,?,?,?,?)`,
    ).bind(jobId, ownerUserId, entryId, revisionNumber, quota.id, now, now, analysisDomain),
    env.DB.prepare(
      `UPDATE jobs SET status='superseded',updated_at=?,completed_at=?,revision=revision+1
      WHERE owner_user_id=? AND target_type='entry' AND target_id=? AND id<>?
         AND status IN ('queued','waiting_for_user','retrying')`,
    ).bind(now, now, ownerUserId, entryId, jobId),
  ];
  const entryUpdateIndex = statements.length;
  statements.push(
    env.DB.prepare(
      `UPDATE user_character_entries SET status='submitted',active_revision_number=?,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND active_revision_number=?`,
    ).bind(revisionNumber, now, entryId, ownerUserId, current.active_revision_number),
    outbox.statement,
  );
  if (profileOutbox)
    statements.push(
      env.DB.prepare(`
            INSERT INTO projection_rebuild_states (owner_user_id,desired_generation,built_generation,status,updated_at)
            VALUES (?,?,?,'queued',?) ON CONFLICT(owner_user_id) DO UPDATE SET
              desired_generation=excluded.desired_generation,status='queued',updated_at=excluded.updated_at
          `).bind(ownerUserId, desiredGeneration, projectionState?.built_generation ?? 0, now),
      env.DB.prepare(
        `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,
             progress_total,current_step,retryable,revision,created_at,updated_at)
             VALUES (?,?,'profile_rebuild','queued','user',?,?,0,2,'profile',1,1,?,?)`,
      ).bind(profileJobId, ownerUserId, ownerUserId, desiredGeneration, now, now),
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

export async function listEntries(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
): Promise<EntrySummary[]> {
  const rows = await all<{
    id: string;
    registration_type: EntrySummary["registrationType"];
    status: string;
    active_revision_number: number;
    updated_at: string;
    registration_payload_json: string;
    review_target_id: string | null;
    job_id: string | null;
    job_status: string | null;
    retryable: number | null;
    current_step: string | null;
    progress_current: number | null;
    progress_total: number | null;
    error_code: string | null;
    error_detail_safe: string | null;
  }>(
    env.DB.prepare(`
    SELECT e.id,e.registration_type,e.status,e.active_revision_number,e.updated_at,er.registration_payload_json,
      CASE WHEN e.status='understanding_review' THEN (SELECT id FROM character_understanding_snapshots WHERE owner_user_id=e.owner_user_id AND representation_id=er.representation_id ORDER BY created_at DESC LIMIT 1)
           WHEN e.status='analysis_review' THEN (SELECT id FROM analysis_runs WHERE owner_user_id=e.owner_user_id AND entry_revision_id=er.id ORDER BY created_at DESC LIMIT 1)
           ELSE NULL END AS review_target_id,
      j.id AS job_id,j.status AS job_status,j.retryable,j.current_step,j.progress_current,j.progress_total,
      j.error_code,j.error_detail_safe
    FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    LEFT JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id AND j.input_generation=e.active_revision_number
    WHERE e.owner_user_id=? AND e.analysis_domain=? AND e.status<>'archived'
    ORDER BY e.updated_at DESC,e.id
  `).bind(ownerUserId, analysisDomain),
  );
  return rows.map((row) => {
    const draft = JSON.parse(row.registration_payload_json) as AnyEntryDraft;
    return {
      id: row.id,
      registrationType: row.registration_type,
      status: row.status,
      title: draft.characterName,
      subtitle: draft.registrationType === "original" ? "オリジナル" : draft.workTitle,
      activeRevisionNumber: row.active_revision_number,
      updatedAt: row.updated_at,
      reviewTargetId: row.review_target_id,
      job: row.job_id
        ? {
            id: row.job_id,
            status: row.job_status ?? "queued",
            retryable: row.retryable === 1,
            currentStep: row.current_step,
            progressCurrent: row.progress_current ?? 0,
            progressTotal: row.progress_total ?? 15,
            errorCode: row.error_code,
            errorDetail: row.error_detail_safe,
          }
        : null,
    };
  });
}

export async function loadEntryReview(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain, entryId: string) {
  const entry = await first<{
    status: string;
    registration_type: string;
    registration_payload_json: string;
    revision_id: string;
    representation_id: string;
  }>(
    env.DB.prepare(`
    SELECT e.status,e.registration_type,er.registration_payload_json,er.id AS revision_id,er.representation_id
    FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=?
  `).bind(entryId, ownerUserId, analysisDomain),
  );
  if (!entry) return null;
  const snapshot = await first<{
    id: string;
    base_snapshot_id: string | null;
    source_assessment_json: string;
    summary_json: string;
    uncertainties_json: string;
    overall_confidence: number;
    status: string;
  }>(
    env.DB.prepare(
      `SELECT id,base_snapshot_id,source_assessment_json,summary_json,uncertainties_json,overall_confidence,status FROM character_understanding_snapshots WHERE owner_user_id=? AND representation_id=? ORDER BY created_at DESC LIMIT 1`,
    ).bind(ownerUserId, entry.representation_id),
  );
  const assertions = snapshot
    ? await all<{
        id: string;
        raw_label: string;
        value_text: string;
        assertion_kind: string;
        explicitness: string;
        confidence: number;
        status: string;
        stable_key: string | null;
      }>(
        env.DB.prepare(
          `SELECT ca.id,COALESCE(ad.label,ca.raw_label) AS raw_label,ca.value_text,ca.assertion_kind,
                  ca.explicitness,ca.confidence,ca.status,ad.stable_key
           FROM character_assertions ca LEFT JOIN attribute_definitions ad ON ad.id=ca.attribute_definition_id
           WHERE ca.snapshot_id=? AND ca.status NOT IN ('rejected','superseded') ORDER BY ca.ordinal,ca.id`,
        ).bind(snapshot.id),
      )
    : [];
  const deltas = snapshot
    ? await all<{
        id: string;
        operation: string;
        before_value: string | null;
        after_value: string | null;
        scope_json: string;
        reason_text: string | null;
        explicitness: string;
        confidence: number;
        status: string;
      }>(
        env.DB.prepare(
          `SELECT id,operation,before_value,after_value,scope_json,reason_text,explicitness,confidence,status
           FROM customization_deltas WHERE snapshot_id=? AND status <> 'rejected' ORDER BY ordinal,id`,
        ).bind(snapshot.id),
      )
    : [];
  const baseSnapshot = snapshot?.base_snapshot_id
    ? await first<{
        id: string;
        source_assessment_json: string;
        summary_json: string;
        uncertainties_json: string;
        overall_confidence: number;
        status: string;
      }>(
        env.DB.prepare(
          `SELECT id,source_assessment_json,summary_json,uncertainties_json,overall_confidence,status FROM character_understanding_snapshots WHERE id=? AND owner_user_id=?`,
        ).bind(snapshot.base_snapshot_id, ownerUserId),
      )
    : null;
  const baseAssertions = baseSnapshot
    ? await all<{
        id: string;
        raw_label: string;
        value_text: string;
        assertion_kind: string;
        explicitness: string;
        confidence: number;
        status: string;
        stable_key: string | null;
      }>(
        env.DB.prepare(
          `SELECT ca.id,COALESCE(ad.label,ca.raw_label) AS raw_label,ca.value_text,ca.assertion_kind,
                  ca.explicitness,ca.confidence,ca.status,ad.stable_key
           FROM character_assertions ca LEFT JOIN attribute_definitions ad ON ad.id=ca.attribute_definition_id
           WHERE ca.snapshot_id=? AND ca.status NOT IN ('rejected','superseded') ORDER BY ca.ordinal,ca.id`,
        ).bind(baseSnapshot.id),
      )
    : [];
  const analysis = await first<{ id: string; summary_json: string; uncertainties_json: string; status: string }>(
    env.DB.prepare(
      `SELECT id,summary_json,uncertainties_json,status FROM analysis_runs WHERE owner_user_id=? AND entry_revision_id=? ORDER BY created_at DESC LIMIT 1`,
    ).bind(ownerUserId, entry.revision_id),
  );
  const preferences = analysis
    ? await all<{
        id: string;
        raw_label: string;
        polarity: string;
        response_channel: string;
        strength: number;
        explicitness: string;
        confidence: number;
        status: string;
        stable_key: string | null;
      }>(
        env.DB.prepare(
          `SELECT pa.id,COALESCE(ad.label,rm.raw_label) AS raw_label,pa.polarity,pa.response_channel,
                  pa.strength,pa.explicitness,pa.confidence,pa.status,ad.stable_key
           FROM preference_assertions pa JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id
           LEFT JOIN attribute_definitions ad ON ad.id=pa.attribute_definition_id
           WHERE pa.analysis_run_id=? AND pa.status NOT IN ('rejected','superseded')
           ORDER BY pa.created_at,pa.id`,
        ).bind(analysis.id),
      )
    : [];
  const valueStances = analysis
    ? await all<{
        id: string;
        target_ref: string;
        stance: string;
        orientation: string;
        explicitness: string;
        confidence: number;
        status: string;
      }>(
        env.DB.prepare(
          `SELECT id,target_ref,stance,orientation,explicitness,confidence,status
           FROM value_stance_assertions
           WHERE analysis_run_id=? AND status NOT IN ('rejected','superseded')
           ORDER BY created_at,id`,
        ).bind(analysis.id),
      )
    : [];
  const darkScopeAssessment =
    analysisDomain === "dark"
      ? await first<{ id: string; verdict: string; status: string; assessment_json: string }>(
          env.DB.prepare(
            `SELECT id,verdict,status,assessment_json FROM dark_scope_assessments
             WHERE owner_user_id=? AND entry_revision_id=? LIMIT 1`,
          ).bind(ownerUserId, entry.revision_id),
        )
      : null;
  const darkBaseline =
    analysisDomain === "dark"
      ? await first<{ id: string; baseline_json: string }>(
          env.DB.prepare(
            `SELECT id,baseline_json FROM dark_baseline_snapshots
             WHERE owner_user_id=? AND entry_revision_id=? LIMIT 1`,
          ).bind(ownerUserId, entry.revision_id),
        )
      : null;
  const darkTransformationDeltas =
    analysisDomain === "dark" && snapshot
      ? await all<{
          id: string;
          operation: string;
          aspect: string;
          before_value: string | null;
          after_value: string | null;
          detail_json: string;
          confidence: number;
        }>(
          env.DB.prepare(
            `SELECT id,operation,aspect,before_value,after_value,detail_json,confidence
             FROM dark_transformation_deltas
             WHERE owner_user_id=? AND understanding_snapshot_id=? ORDER BY ordinal,id`,
          ).bind(ownerUserId, snapshot.id),
        )
      : [];
  const [understandingEvidence, baseUnderstandingEvidence, preferenceEvidence, stanceEvidence, attributeRows] =
    await Promise.all([
      loadEvidenceViews(
        env,
        ownerUserId,
        "character_assertion",
        assertions.map((item) => item.id),
      ),
      loadEvidenceViews(
        env,
        ownerUserId,
        "character_assertion",
        baseAssertions.map((item) => item.id),
      ),
      loadEvidenceViews(
        env,
        ownerUserId,
        "preference_assertion",
        preferences.map((item) => item.id),
      ),
      loadEvidenceViews(
        env,
        ownerUserId,
        "value_stance_assertion",
        valueStances.map((item) => item.id),
      ),
      snapshot || baseSnapshot
        ? all<{ stable_key: string; label: string }>(
            env.DB.prepare(`
            SELECT d.stable_key,d.label
            FROM attribute_definitions d
            JOIN attribute_schema_versions v ON v.id=d.schema_version_id
            WHERE v.status='active' AND v.analysis_domain=? AND d.status='active'
            ORDER BY d.stable_key
          `).bind(analysisDomain),
          )
        : Promise.resolve([]),
    ]);
  const attributeLabels = new Map(attributeRows.map((row) => [row.stable_key, row.label]));
  return {
    entry: {
      id: entryId,
      status: entry.status,
      registrationType: entry.registration_type,
      draft: JSON.parse(entry.registration_payload_json),
    },
    ontologyAttributes: attributeRows.map((item) => ({ stableKey: item.stable_key, label: item.label })),
    darkScopeAssessment: darkScopeAssessment
      ? { ...darkScopeAssessment, assessment: JSON.parse(darkScopeAssessment.assessment_json) }
      : null,
    darkBaseline: darkBaseline ? { id: darkBaseline.id, ...JSON.parse(darkBaseline.baseline_json) } : null,
    darkTransformationDeltas: darkTransformationDeltas.map((item) => ({
      ...item,
      detail: JSON.parse(item.detail_json),
    })),
    understanding: snapshot
      ? {
          id: snapshot.id,
          baseSnapshotId: snapshot.base_snapshot_id,
          sourceAssessment: JSON.parse(snapshot.source_assessment_json),
          summary: localizeUnderstandingSummary(JSON.parse(snapshot.summary_json), attributeLabels),
          uncertainties: JSON.parse(snapshot.uncertainties_json),
          confidence: snapshot.overall_confidence,
          status: snapshot.status,
          assertions: assertions.map((item) => ({ ...item, evidence: understandingEvidence.get(item.id) ?? [] })),
          deltas,
        }
      : null,
    baseUnderstanding: baseSnapshot
      ? {
          id: baseSnapshot.id,
          sourceAssessment: JSON.parse(baseSnapshot.source_assessment_json),
          summary: localizeUnderstandingSummary(JSON.parse(baseSnapshot.summary_json), attributeLabels),
          uncertainties: JSON.parse(baseSnapshot.uncertainties_json),
          confidence: baseSnapshot.overall_confidence,
          status: baseSnapshot.status,
          assertions: baseAssertions.map((item) => ({
            ...item,
            evidence: baseUnderstandingEvidence.get(item.id) ?? [],
          })),
        }
      : null,
    preferenceAnalysis: analysis
      ? {
          id: analysis.id,
          summary: JSON.parse(analysis.summary_json),
          uncertainties: JSON.parse(analysis.uncertainties_json),
          status: analysis.status,
          assertions: preferences.map((item) => ({ ...item, evidence: preferenceEvidence.get(item.id) ?? [] })),
          valueStances: valueStances.map((item) => ({
            ...item,
            target_ref: localizeAttributeReference(item.target_ref, attributeLabels),
            evidence: stanceEvidence.get(item.id) ?? [],
          })),
        }
      : null,
  };
}

export async function reviewDarkScopeAssessment(
  env: Env,
  ownerUserId: string,
  assessmentId: string,
  input: DarkScopeReviewRequest,
): Promise<{ entryId: string; status: "queued" | "cancelled"; outboxEventId: string | null }> {
  const target = await first<{
    entry_id: string;
    revision_number: number;
    job_id: string;
    status: string;
  }>(
    env.DB.prepare(
      `SELECT e.id AS entry_id,er.revision_number,j.id AS job_id,dsa.status
       FROM dark_scope_assessments dsa
       JOIN entry_revisions er ON er.id=dsa.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
         AND j.input_generation=er.revision_number
       WHERE dsa.id=? AND dsa.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain='dark'
         AND dsa.verdict='out_of_scope'`,
    ).bind(assessmentId, ownerUserId, ownerUserId),
  );
  if (!target) throw new Error("DARK_SCOPE_REVIEW_NOT_FOUND");
  if (target.status === "cancelled") return { entryId: target.entry_id, status: "cancelled", outboxEventId: null };
  if (target.status === "overridden") return { entryId: target.entry_id, status: "queued", outboxEventId: null };
  if (target.status !== "proposed") throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
  const now = nowIso();
  if (input.decision === "cancel") {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE dark_scope_assessments SET status='cancelled',reviewed_at=? WHERE id=? AND owner_user_id=? AND status='proposed'`,
      ).bind(now, assessmentId, ownerUserId),
      env.DB.prepare(
        `UPDATE user_character_entries SET status='archived',archived_at=?,updated_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='understanding_review'`,
      ).bind(now, now, target.entry_id, ownerUserId),
      env.DB.prepare(
        `UPDATE jobs SET status='cancelled',retryable=0,current_step='cancelled',updated_at=?,completed_at=?,revision=revision+1
         WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='waiting_for_user'`,
      ).bind(now, now, target.job_id, ownerUserId),
    ]);
    if (results.some((item) => !item.success || !item.meta.changes)) throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
    return { entryId: target.entry_id, status: "cancelled", outboxEventId: null };
  }
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
        stage: "understanding",
        inputGeneration: target.revision_number,
        analysisDomain: "dark",
      },
    },
    `dark-scope:${target.job_id}:${target.revision_number}:override`,
    assessmentId,
  );
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE dark_scope_assessments SET status='overridden',reviewed_at=? WHERE id=? AND owner_user_id=? AND status='proposed'`,
    ).bind(now, assessmentId, ownerUserId),
    env.DB.prepare(
      `UPDATE user_character_entries SET status='submitted',updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='understanding_review'`,
    ).bind(now, target.entry_id, ownerUserId),
    env.DB.prepare(
      `UPDATE jobs SET status='queued',current_step='queued',progress_current=0,workflow_instance_id=NULL,
       completed_at=NULL,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND analysis_domain='dark' AND status='waiting_for_user'`,
    ).bind(now, target.job_id, ownerUserId),
    outbox.statement,
  ]);
  if (
    results.some((item) => !item.success) ||
    !results[0].meta.changes ||
    !results[1].meta.changes ||
    !results[2].meta.changes
  )
    throw new Error("DARK_SCOPE_REVIEW_STATE_CHANGED");
  return { entryId: target.entry_id, status: "queued", outboxEventId: outbox.id };
}

export async function rejectPreferenceAnalysisItem(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  analysisRunId: string,
  targetId: string,
): Promise<{
  analysisRunId: string;
  targetId: string;
  targetType: "preference_assertion" | "value_stance_assertion";
  replayed: boolean;
}> {
  const run = await first<{ id: string }>(
    env.DB.prepare(
      `SELECT ar.id
       FROM analysis_runs ar
       JOIN entry_revisions er ON er.id=ar.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=?
         AND ar.status='succeeded' AND e.status='analysis_review'`,
    ).bind(analysisRunId, ownerUserId, ownerUserId, analysisDomain),
  );
  if (!run) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");

  const targets = await all<{
    target_type: "preference_assertion" | "value_stance_assertion";
    status: string;
  }>(
    env.DB.prepare(
      `SELECT 'preference_assertion' AS target_type,status
       FROM preference_assertions WHERE id=? AND owner_user_id=? AND analysis_run_id=?
       UNION ALL
       SELECT 'value_stance_assertion' AS target_type,status
       FROM value_stance_assertions WHERE id=? AND owner_user_id=? AND analysis_run_id=?`,
    ).bind(targetId, ownerUserId, analysisRunId, targetId, ownerUserId, analysisRunId),
  );
  if (targets.length !== 1) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
  const target = targets[0];
  if (target.status === "rejected") {
    return { analysisRunId, targetId, targetType: target.target_type, replayed: true };
  }
  if (!new Set(["proposed", "corrected"]).has(target.status)) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");

  const statement =
    target.target_type === "preference_assertion"
      ? env.DB.prepare(
          `UPDATE preference_assertions SET status='rejected'
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
        )
      : env.DB.prepare(
          `UPDATE value_stance_assertions SET status='rejected'
           WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
        );
  const result = await statement.bind(targetId, ownerUserId, analysisRunId).run();
  if (!result.success) throw new Error("D1_PREFERENCE_REVIEW_FAILED");
  if (!result.meta.changes) throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { analysisRunId, targetId, targetType: target.target_type, replayed: false };
}

export async function mutatePreferenceReview(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  analysisRunId: string,
  input: PreferenceReviewMutation,
  idempotencyKey: string,
): Promise<{
  analysisRunId: string;
  changedId: string;
  action: PreferenceReviewMutation["action"];
  replayed: boolean;
}> {
  const changedId = await deriveUuid(
    env.AUTH_PEPPER,
    `preference-review:${ownerUserId}:${analysisDomain}:${analysisRunId}:${idempotencyKey}`,
  );
  const alreadyExists = await first<{ id: string }>(
    env.DB.prepare(
      `SELECT id FROM preference_assertions WHERE id=? AND owner_user_id=?
       UNION ALL SELECT id FROM value_stance_assertions WHERE id=? AND owner_user_id=? LIMIT 1`,
    ).bind(changedId, ownerUserId, changedId, ownerUserId),
  );
  if (alreadyExists) return { analysisRunId, changedId, action: input.action, replayed: true };
  const run = await first<{
    entry_revision_id: string;
    character_identity_id: string;
    representation_id: string;
    registration_payload_json: string;
  }>(
    env.DB.prepare(
      `SELECT ar.entry_revision_id,cr.character_identity_id,er.representation_id,er.registration_payload_json
       FROM analysis_runs ar
       JOIN entry_revisions er ON er.id=ar.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN character_representations cr ON cr.id=er.representation_id
       WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=?
         AND ar.status='succeeded' AND e.status='analysis_review'`,
    ).bind(analysisRunId, ownerUserId, ownerUserId, analysisDomain),
  );
  if (!run) throw new Error("PREFERENCE_REVIEW_NOT_FOUND");
  const now = nowIso();
  const draft = anyEntryDraftSchema.parse(JSON.parse(run.registration_payload_json));
  const contextJson = JSON.stringify({
    schemaVersion: "2",
    entryScope: entryScopeText(draft),
    subjects: [],
    relationships: [],
    narrativePhases: [],
    conditions: ["ユーザーが確認画面で追加・修正"],
    exceptions: [],
  });
  if (input.action === "add_preference" || input.action === "update_preference") {
    const allowedChannels = analysisDomain === "dark" ? darkResponseChannelValues : responseChannelValues;
    if (!(allowedChannels as readonly string[]).includes(input.responseChannel))
      throw new Error("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    const attribute = input.attributeStableKey
      ? await first<{ id: string }>(
          env.DB.prepare(
            `SELECT d.id FROM attribute_definitions d JOIN attribute_schema_versions v ON v.id=d.schema_version_id
             WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=? LIMIT 1`,
          ).bind(input.attributeStableKey, analysisDomain),
        )
      : null;
    if (input.attributeStableKey && !attribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
    const rawId = await deriveUuid(env.AUTH_PEPPER, `${changedId}:raw`);
    const old =
      input.action === "update_preference"
        ? await first<{ raw_mention_id: string | null; context_json: string }>(
            env.DB.prepare(
              `SELECT raw_mention_id,context_json FROM preference_assertions
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
            ).bind(input.targetId, ownerUserId, analysisRunId),
          )
        : null;
    if (input.action === "update_preference" && !old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
    const statements: D1PreparedStatement[] = [
      ...(old?.raw_mention_id
        ? [
            env.DB.prepare(
              `UPDATE attribute_mappings SET mapping_status='rejected',decided_by_user_id=?,decided_at=?
               WHERE raw_mention_id=? AND mapping_status IN ('candidate','accepted','unmapped')`,
            ).bind(ownerUserId, now, old.raw_mention_id),
          ]
        : []),
      env.DB.prepare(
        `INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,locale,normalized_label,created_at)
         VALUES (?,?,'user','preference_assertion',?,?,'ja',?,?)`,
      ).bind(rawId, ownerUserId, changedId, input.rawLabel, normalizeIdentityPart(input.rawLabel), now),
      env.DB.prepare(
        `INSERT INTO attribute_mappings
          (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
         VALUES (?,?,?,?, 'user',1,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        rawId,
        attribute?.id ?? null,
        attribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO preference_assertions
          (id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,
           attribute_definition_id,raw_mention_id,analysis_domain,polarity,response_channel,strength,explicitness,
           confidence,context_json,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'user_confirmed',1,?,'corrected',?)`,
      ).bind(
        changedId,
        ownerUserId,
        analysisRunId,
        run.entry_revision_id,
        run.character_identity_id,
        run.representation_id,
        attribute?.id ?? null,
        rawId,
        analysisDomain,
        input.polarity,
        input.responseChannel,
        input.strength,
        old?.context_json ?? contextJson,
        now,
      ),
      ...(input.action === "update_preference"
        ? [
            env.DB.prepare(
              `UPDATE preference_assertions SET status='superseded',superseded_by_id=?
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
            ).bind(changedId, input.targetId, ownerUserId, analysisRunId),
          ]
        : []),
    ];
    const results = await env.DB.batch(statements);
    if (results.some((item) => !item.success) || !results.at(-1)?.meta.changes)
      throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  } else {
    const old =
      input.action === "update_value_stance"
        ? await first<{ scope_json: string }>(
            env.DB.prepare(
              `SELECT scope_json FROM value_stance_assertions
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
            ).bind(input.targetId, ownerUserId, analysisRunId),
          )
        : null;
    if (input.action === "update_value_stance" && !old) throw new Error("PREFERENCE_REVIEW_TARGET_NOT_FOUND");
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO value_stance_assertions
          (id,owner_user_id,analysis_run_id,target_type,target_ref,stance,orientation,scope_json,
           explicitness,confidence,status,created_at)
         VALUES (?,?,?,'value',?,?,?,?, 'user_confirmed',1,'corrected',?)`,
      ).bind(
        changedId,
        ownerUserId,
        analysisRunId,
        input.targetRef,
        input.stance,
        input.orientation,
        old?.scope_json ?? contextJson,
        now,
      ),
      ...(input.action === "update_value_stance"
        ? [
            env.DB.prepare(
              `UPDATE value_stance_assertions SET status='superseded',superseded_by_id=?
               WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected')`,
            ).bind(changedId, input.targetId, ownerUserId, analysisRunId),
          ]
        : []),
    ];
    const results = await env.DB.batch(statements);
    if (results.some((item) => !item.success) || !results.at(-1)?.meta.changes)
      throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  }
  return { analysisRunId, changedId, action: input.action, replayed: false };
}

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
    env.DB.prepare(
      `SELECT correction_payload_json FROM understanding_reviews WHERE id=? AND owner_user_id=? AND snapshot_id=?`,
    ).bind(reviewId, ownerUserId, snapshotId),
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

  const context = await first<{ id: string }>(
    env.DB.prepare(`
      SELECT s.id FROM character_understanding_snapshots s
      JOIN character_understanding_runs ur ON ur.id=s.understanding_run_id
      JOIN entry_revisions er ON er.id=ur.entry_revision_id
      JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
      WHERE s.id=? AND s.owner_user_id=? AND e.owner_user_id=?
        AND e.analysis_domain=? AND e.status='understanding_review' AND s.status IN ('proposed','needs_review')
    `).bind(snapshotId, ownerUserId, ownerUserId, analysisDomain),
  );
  if (!context) throw new Error("UNDERSTANDING_REVIEW_NOT_FOUND");
  const generation = await first<{ value: number }>(
    env.DB.prepare(
      `SELECT COALESCE(MAX(review_generation),0)+1 AS value FROM understanding_reviews WHERE snapshot_id=?`,
    ).bind(snapshotId),
  );
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
        env.DB.prepare(
          `SELECT d.id FROM attribute_definitions d
           JOIN attribute_schema_versions v ON v.id=d.schema_version_id
           WHERE d.stable_key=? AND d.status='active' AND v.status='active' AND v.analysis_domain=? LIMIT 1`,
        ).bind(assertionAttributeKey, analysisDomain),
      )
    : null;
  if (assertionAttributeKey && !assertionAttribute) throw new Error("ATTRIBUTE_NOT_FOUND_IN_DOMAIN");
  const correctedRawId = await deriveUuid(env.AUTH_PEPPER, `${reviewId}:raw`);

  if (input.action === "add_assertion") {
    const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,raw_value,locale,normalized_label,created_at)
         VALUES (?,?,'user','character_assertion',?,?,?,'ja',?,?)`,
      ).bind(
        correctedRawId,
        ownerUserId,
        changedId,
        input.rawLabel,
        input.valueText,
        normalizeIdentityPart(input.rawLabel),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO attribute_mappings
          (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
         VALUES (?,?,?,?, 'user',1,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        correctedRawId,
        assertionAttribute?.id ?? null,
        assertionAttribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO character_assertions
          (id,owner_user_id,snapshot_id,attribute_definition_id,raw_mention_id,raw_label,value_text,
           assertion_kind,scope_json,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,?,?,?,?,?,?,'user_interpretation',?,'user_explicit',1,'corrected',
               COALESCE((SELECT MAX(ordinal)+1 FROM character_assertions WHERE snapshot_id=?),0),?
        FROM character_understanding_snapshots s
        WHERE s.id=? AND s.owner_user_id=? AND s.status IN ('proposed','needs_review')
      `).bind(
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
      ),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?, 'character_assertion',?,'correct',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=?
      `).bind(
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
      ),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "update_assertion") {
    const current = await first<{ raw_label: string; value_text: string; raw_mention_id: string | null }>(
      env.DB.prepare(
        `SELECT raw_label,value_text,raw_mention_id FROM character_assertions
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(input.targetId, ownerUserId, snapshotId),
    );
    if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
    const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
    const results = await env.DB.batch([
      ...(current.raw_mention_id
        ? [
            env.DB.prepare(
              `UPDATE attribute_mappings SET mapping_status='rejected',decided_by_user_id=?,decided_at=?
               WHERE raw_mention_id=? AND mapping_status IN ('candidate','accepted','unmapped')`,
            ).bind(ownerUserId, now, current.raw_mention_id),
          ]
        : []),
      env.DB.prepare(
        `INSERT INTO raw_attribute_mentions
          (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,raw_value,locale,normalized_label,created_at)
         VALUES (?,?,'user','character_assertion',?,?,?,'ja',?,?)`,
      ).bind(
        correctedRawId,
        ownerUserId,
        changedId,
        input.rawLabel,
        input.valueText,
        normalizeIdentityPart(input.rawLabel),
        now,
      ),
      env.DB.prepare(
        `INSERT INTO attribute_mappings
          (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
         VALUES (?,?,?,?, 'user',1,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        correctedRawId,
        assertionAttribute?.id ?? null,
        assertionAttribute ? "accepted" : "unmapped",
        ownerUserId,
        now,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO character_assertions
          (id,owner_user_id,snapshot_id,attribute_definition_id,raw_mention_id,raw_label,value_text,
           assertion_kind,scope_json,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,owner_user_id,snapshot_id,?,?,?,?,'user_interpretation',scope_json,
               'user_explicit',1,'corrected',ordinal,?
        FROM character_assertions
        WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')
      `).bind(
        changedId,
        assertionAttribute?.id ?? null,
        correctedRawId,
        input.rawLabel,
        input.valueText,
        now,
        input.targetId,
        ownerUserId,
        snapshotId,
      ),
      env.DB.prepare(
        `UPDATE character_assertions SET status='superseded',superseded_by_id=?
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(changedId, input.targetId, ownerUserId, snapshotId),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'character_assertion',?,'correct',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='corrected'
      `).bind(
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
      ),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "delete_assertion") {
    const correction = JSON.stringify({ action: input.action, changedId });
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE character_assertions SET status='rejected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(input.targetId, ownerUserId, snapshotId),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'character_assertion',?,'reject',?,?,?
        FROM character_assertions WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='rejected'
      `).bind(
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
      ),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else if (input.action === "add_delta") {
    if (input.operation === "remove") throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
    const correction = JSON.stringify({ action: input.action, changedId, newValue: input });
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO customization_deltas
          (id,owner_user_id,snapshot_id,base_assertion_id,operation,target_attribute_id,before_value,after_value,
           scope_json,reason_text,explicitness,confidence,status,ordinal,created_at)
        SELECT ?,?,?,NULL,?,NULL,?,?,?,?,'user_explicit',1,'corrected',
               COALESCE((SELECT MAX(ordinal)+1 FROM customization_deltas WHERE snapshot_id=?),0),?
        FROM character_understanding_snapshots s
        WHERE s.id=? AND s.owner_user_id=? AND s.status IN ('proposed','needs_review')
      `).bind(
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
      ),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'correct',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=?
      `).bind(
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
      ),
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
    }>(
      env.DB.prepare(
        `SELECT base_assertion_id,operation,before_value,after_value,reason_text FROM customization_deltas
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(input.targetId, ownerUserId, snapshotId),
    );
    if (!current) throw new Error("UNDERSTANDING_REVIEW_TARGET_NOT_FOUND");
    if (input.operation === "remove" && !current.base_assertion_id)
      throw new Error("UNDERSTANDING_DELTA_REMOVE_REQUIRES_BASE");
    const correction = JSON.stringify({ action: input.action, changedId, oldValue: current, newValue: input });
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE customization_deltas
         SET operation=?,before_value=?,after_value=?,reason_text=?,explicitness='user_explicit',confidence=1,status='corrected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(
        input.operation,
        input.beforeValue,
        input.afterValue,
        input.reasonText,
        input.targetId,
        ownerUserId,
        snapshotId,
      ),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'correct',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='corrected'
      `).bind(
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
      ),
    ]);
    if (results.some((result) => !result.success) || results.some((result) => !result.meta.changes))
      throw new Error("UNDERSTANDING_REVIEW_STATE_CHANGED");
  } else {
    const correction = JSON.stringify({ action: input.action, changedId });
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE customization_deltas SET status='rejected'
         WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status IN ('proposed','corrected')`,
      ).bind(input.targetId, ownerUserId, snapshotId),
      env.DB.prepare(`
        INSERT INTO understanding_reviews
          (id,owner_user_id,snapshot_id,target_type,target_id,decision,correction_payload_json,review_generation,created_at)
        SELECT ?,?,?,'customization_delta',?,'reject',?,?,?
        FROM customization_deltas WHERE id=? AND owner_user_id=? AND snapshot_id=? AND status='rejected'
      `).bind(
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
      ),
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
  }>(
    env.DB.prepare(
      `SELECT s.id,s.base_snapshot_id,e.id AS entry_id,er.revision_number,j.id AS job_id
       FROM character_understanding_snapshots s
       JOIN character_understanding_runs ur ON ur.id=s.understanding_run_id
       JOIN entry_revisions er ON er.id=ur.entry_revision_id
       JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
       JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id
         AND j.input_generation=er.revision_number
       WHERE s.id=? AND s.owner_user_id=? AND e.owner_user_id=?
         AND e.analysis_domain=? AND e.status='understanding_review' AND s.status IN ('proposed','needs_review')`,
    ).bind(snapshotId, ownerUserId, ownerUserId, analysisDomain),
  );
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
    env.DB.prepare(
      `INSERT INTO understanding_reviews (id,owner_user_id,snapshot_id,target_type,target_id,decision,review_generation,created_at) VALUES (?,?,?,'snapshot',?,'confirm',1,?)`,
    ).bind(crypto.randomUUID(), ownerUserId, snapshotId, snapshotId, now),
    env.DB.prepare(
      `UPDATE character_understanding_snapshots SET status='confirmed' WHERE id=? AND owner_user_id=? AND status IN ('proposed','needs_review')`,
    ).bind(snapshotId, ownerUserId),
    env.DB.prepare(`UPDATE character_assertions SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`).bind(
      snapshotId,
    ),
    env.DB.prepare(`UPDATE customization_deltas SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`).bind(
      snapshotId,
    ),
    env.DB.prepare(
      `UPDATE user_character_entries SET status='analyzing',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=?`,
    ).bind(now, target.entry_id, ownerUserId),
    env.DB.prepare(
      `UPDATE jobs SET status='queued',current_step='preferenceAnalysis',progress_current=8,
       workflow_instance_id=NULL,completed_at=NULL,updated_at=?,revision=revision+1
       WHERE id=? AND owner_user_id=? AND target_type='entry' AND target_id=? AND input_generation=?
         AND status='waiting_for_user'`,
    ).bind(now, target.job_id, ownerUserId, target.entry_id, target.revision_number),
    outbox.statement,
  ];
  if (target.base_snapshot_id) {
    reviewStatements.push(
      env.DB.prepare(
        `INSERT INTO understanding_reviews (id,owner_user_id,snapshot_id,target_type,target_id,decision,review_generation,created_at) VALUES (?,?,?,'snapshot',?,'confirm',1,?)`,
      ).bind(crypto.randomUUID(), ownerUserId, target.base_snapshot_id, target.base_snapshot_id, now),
      env.DB.prepare(
        `UPDATE character_understanding_snapshots SET status='confirmed' WHERE id=? AND owner_user_id=? AND status IN ('proposed','needs_review')`,
      ).bind(target.base_snapshot_id, ownerUserId),
      env.DB.prepare(
        `UPDATE character_assertions SET status='confirmed' WHERE snapshot_id=? AND status='proposed'`,
      ).bind(target.base_snapshot_id),
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
