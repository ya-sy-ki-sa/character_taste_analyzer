import { type EntryDraft, type EntrySummary, entryReferenceMaterial, entryScopeText } from "../../shared/schemas";
import { normalizeIdentityPart, nowIso, sha256Hex } from "../lib/crypto";
import { all, first } from "../lib/db";
import type { Env } from "../types";

export type CreatedEntry = { entryId: string; jobId: string; status: string; replayed: boolean };

function registrationTitle(draft: EntryDraft): string {
  return draft.registrationType === "original" ? draft.characterName : `${draft.workTitle} / ${draft.characterName}`;
}

export async function createEntry(
  env: Env,
  ownerUserId: string,
  draft: EntryDraft,
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
    WHERE e.owner_user_id=? AND json_extract(e.draft_payload_json,'$.idempotencySeed')=?
    ORDER BY e.created_at DESC LIMIT 1
  `).bind(ownerUserId, seed),
  );
  if (existing) {
    if (existing.content_hash !== payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { entryId: existing.id, jobId: existing.job_id, status: existing.status, replayed: true };
  }

  const ids = {
    entry: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    job: crypto.randomUUID(),
    identity: crypto.randomUUID(),
    work: draft.registrationType === "original" ? null : crypto.randomUUID(),
    workVersion: crypto.randomUUID(),
    representation: crypto.randomUUID(),
    baseRepresentation: draft.registrationType === "customized_existing" ? crypto.randomUUID() : null,
    sourceDocument: crypto.randomUUID(),
    sourceRevision: crypto.randomUUID(),
    sourceFragment: crypto.randomUUID(),
    sourceSet: crypto.randomUUID(),
    sourceSetVersion: crypto.randomUUID(),
  };
  const now = nowIso();
  const scopeText = entryScopeText(draft);
  const characterBasicInfo = draft.registrationType === "original" ? draft.characterBasicInfo : undefined;
  const referenceMaterial = entryReferenceMaterial(draft);
  const providedCharacterMaterial = [
    characterBasicInfo ? `【キャラクター基本情報】\n${characterBasicInfo}` : undefined,
    referenceMaterial ? `【追加の参考情報】\n${referenceMaterial}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const sourceHash = providedCharacterMaterial ? await sha256Hex(providedCharacterMaterial) : undefined;
  const statements: D1PreparedStatement[] = [];
  if (draft.registrationType !== "original" && ids.work) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO works (id,owner_user_id,title,title_normalized,media_type,visibility,catalog_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,'private','user_created',1,?,?)`,
      ).bind(
        ids.work,
        ownerUserId,
        draft.workTitle,
        normalizeIdentityPart(draft.workTitle),
        draft.mediaType ?? null,
        now,
        now,
      ),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO work_versions (id,work_id,version_number,title,aliases_json,description,source_note,content_hash,created_by_user_id,created_at) VALUES (?,?,1,?,'[]',NULL,'ユーザー登録',?,?,?)`,
      ).bind(ids.workVersion, ids.work, draft.workTitle, await sha256Hex(draft.workTitle), ownerUserId, now),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO character_identities (id,origin_type,owner_user_id,work_id,name,name_normalized,visibility,catalog_status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,'private','user_created',1,?,?)`,
    ).bind(
      ids.identity,
      draft.registrationType === "original" ? "original" : "existing",
      ownerUserId,
      ids.work,
      draft.characterName,
      normalizeIdentityPart(draft.characterName),
      now,
      now,
    ),
  );
  if (ids.baseRepresentation && draft.registrationType === "customized_existing") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,content_version,visibility,revision,created_at,updated_at) VALUES (?,?,NULL,?,'canonical_whole','official','whole',?,NULL,?,1,'private',1,?,?)`,
      ).bind(
        ids.baseRepresentation,
        ids.identity,
        ownerUserId,
        `基本像: ${draft.workTitle} / ${draft.characterName}`,
        referenceMaterial?.slice(0, 2000) ?? null,
        now,
        now,
      ),
    );
  }
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
      `INSERT INTO character_representations (id,character_identity_id,base_representation_id,owner_user_id,representation_type,canonicality,scope_type,scope_description,transformation_summary,source_description,content_version,visibility,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,'private',1,?,?)`,
    ).bind(
      ids.representation,
      ids.identity,
      ids.baseRepresentation,
      ownerUserId,
      representationType,
      canonicality,
      scopeType,
      scopeText,
      draft.registrationType === "customized_existing" ? draft.customizationDescription : null,
      (characterBasicInfo ?? referenceMaterial)?.slice(0, 2000) ?? null,
      now,
      now,
    ),
  );
  if (providedCharacterMaterial && sourceHash) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_documents (id,owner_user_id,title,source_type,visibility,citation_json,rights_basis,active_revision_number,revision,created_at,updated_at) VALUES (?,?,?,'user_text','private','{}','user_supplied',1,1,?,?)`,
      ).bind(ids.sourceDocument, ownerUserId, `${registrationTitle(draft)} 基本情報・参考情報`, now, now),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_document_revisions (id,source_document_id,revision_number,inline_text,mime_type,byte_size,content_hash,upload_status,extraction_status,finalized_at,created_at) VALUES (?,?,1,?,'text/plain',?,?,'finalized','ready',?,?)`,
      ).bind(
        ids.sourceRevision,
        ids.sourceDocument,
        providedCharacterMaterial,
        new TextEncoder().encode(providedCharacterMaterial).byteLength,
        sourceHash,
        now,
        now,
      ),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_fragments (id,source_document_revision_id,ordinal,locator_json,text_content,content_hash,token_estimate,created_at) VALUES (?,?,0,'{"type":"full_text"}',?,?,?,?)`,
      ).bind(
        ids.sourceFragment,
        ids.sourceRevision,
        providedCharacterMaterial,
        sourceHash,
        Math.ceil(providedCharacterMaterial.length / 3),
        now,
      ),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_sets (id,owner_user_id,purpose,active_version,created_at,updated_at) VALUES (?,?,'character_understanding',1,?,?)`,
      ).bind(ids.sourceSet, ownerUserId, now, now),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_set_versions (id,source_set_id,version,content_hash,created_at) VALUES (?,?,1,?,?)`,
      ).bind(ids.sourceSetVersion, ids.sourceSet, sourceHash, now),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO source_set_items (source_set_version_id,source_document_revision_id,priority,usage_type) VALUES (?,?,1,'user_definition')`,
      ).bind(ids.sourceSetVersion, ids.sourceRevision),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO user_character_entries (id,owner_user_id,registration_type,status,active_revision_number,active_generation,draft_schema_version,draft_payload_json,draft_updated_at,revision,created_at,updated_at) VALUES (?,?,?,'submitted',1,0,'1',?,?,1,?,?)`,
    ).bind(
      ids.entry,
      ownerUserId,
      draft.registrationType,
      JSON.stringify({ ...draft, idempotencySeed: seed }),
      now,
      now,
      now,
    ),
  );
  statements.push(
    env.DB.prepare(
      `INSERT INTO entry_revisions (id,entry_id,revision_number,representation_id,source_set_version_id,known_scope,user_character_view,preference_input_json,registration_payload_json,content_hash,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)`,
    ).bind(
      ids.revision,
      ids.entry,
      ids.representation,
      providedCharacterMaterial ? ids.sourceSetVersion : null,
      scopeText,
      draft.userCharacterView ?? null,
      JSON.stringify(draft.preference),
      payloadJson,
      payloadHash,
      now,
    ),
  );
  statements.push(
    env.DB.prepare(
      `INSERT INTO jobs (id,owner_user_id,job_type,status,target_type,target_id,input_generation,progress_current,progress_total,current_step,retryable,revision,created_at,updated_at) VALUES (?,?,'character_analysis','queued','entry',?,1,0,15,'queued',1,1,?,?)`,
    ).bind(ids.job, ownerUserId, ids.entry, now, now),
  );
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1_ENTRY_CREATE_FAILED");
  return { entryId: ids.entry, jobId: ids.job, status: "submitted", replayed: false };
}

export async function listEntries(env: Env, ownerUserId: string): Promise<EntrySummary[]> {
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
    current_step: string | null;
    progress_current: number | null;
    progress_total: number | null;
    error_code: string | null;
  }>(
    env.DB.prepare(`
    SELECT e.id,e.registration_type,e.status,e.active_revision_number,e.updated_at,er.registration_payload_json,
      CASE WHEN e.status='understanding_review' THEN (SELECT id FROM character_understanding_snapshots WHERE owner_user_id=e.owner_user_id AND representation_id=er.representation_id ORDER BY created_at DESC LIMIT 1)
           WHEN e.status='analysis_review' THEN (SELECT id FROM analysis_runs WHERE owner_user_id=e.owner_user_id AND entry_revision_id=er.id ORDER BY created_at DESC LIMIT 1)
           ELSE NULL END AS review_target_id,
      j.id AS job_id,j.status AS job_status,j.current_step,j.progress_current,j.progress_total,j.error_code
    FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    LEFT JOIN jobs j ON j.owner_user_id=e.owner_user_id AND j.target_type='entry' AND j.target_id=e.id AND j.input_generation=e.active_revision_number
    WHERE e.owner_user_id=? AND e.deleted_at IS NULL ORDER BY e.updated_at DESC,e.id
  `).bind(ownerUserId),
  );
  return rows.map((row) => {
    const draft = JSON.parse(row.registration_payload_json) as EntryDraft;
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
            currentStep: row.current_step,
            progressCurrent: row.progress_current ?? 0,
            progressTotal: row.progress_total ?? 15,
            errorCode: row.error_code,
          }
        : null,
    };
  });
}

export async function loadEntryReview(env: Env, ownerUserId: string, entryId: string) {
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
    WHERE e.id=? AND e.owner_user_id=? AND e.deleted_at IS NULL
  `).bind(entryId, ownerUserId),
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
      }>(
        env.DB.prepare(
          `SELECT id,raw_label,value_text,assertion_kind,explicitness,confidence,status FROM character_assertions WHERE snapshot_id=? ORDER BY ordinal,id`,
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
          `SELECT id,operation,before_value,after_value,scope_json,reason_text,explicitness,confidence,status FROM customization_deltas WHERE snapshot_id=? ORDER BY ordinal,id`,
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
      }>(
        env.DB.prepare(
          `SELECT id,raw_label,value_text,assertion_kind,explicitness,confidence,status FROM character_assertions WHERE snapshot_id=? ORDER BY ordinal,id`,
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
      }>(
        env.DB.prepare(
          `SELECT pa.id,rm.raw_label,pa.polarity,pa.response_channel,pa.strength,pa.explicitness,pa.confidence,pa.status FROM preference_assertions pa JOIN raw_attribute_mentions rm ON rm.id=pa.raw_mention_id WHERE pa.analysis_run_id=? ORDER BY pa.created_at,pa.id`,
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
          `SELECT id,target_ref,stance,orientation,explicitness,confidence,status FROM value_stance_assertions WHERE analysis_run_id=? ORDER BY created_at,id`,
        ).bind(analysis.id),
      )
    : [];
  return {
    entry: {
      id: entryId,
      status: entry.status,
      registrationType: entry.registration_type,
      draft: JSON.parse(entry.registration_payload_json),
    },
    understanding: snapshot
      ? {
          id: snapshot.id,
          baseSnapshotId: snapshot.base_snapshot_id,
          sourceAssessment: JSON.parse(snapshot.source_assessment_json),
          summary: JSON.parse(snapshot.summary_json),
          uncertainties: JSON.parse(snapshot.uncertainties_json),
          confidence: snapshot.overall_confidence,
          status: snapshot.status,
          assertions,
          deltas,
        }
      : null,
    baseUnderstanding: baseSnapshot
      ? {
          id: baseSnapshot.id,
          sourceAssessment: JSON.parse(baseSnapshot.source_assessment_json),
          summary: JSON.parse(baseSnapshot.summary_json),
          uncertainties: JSON.parse(baseSnapshot.uncertainties_json),
          confidence: baseSnapshot.overall_confidence,
          status: baseSnapshot.status,
          assertions: baseAssertions,
        }
      : null,
    preferenceAnalysis: analysis
      ? {
          id: analysis.id,
          summary: JSON.parse(analysis.summary_json),
          uncertainties: JSON.parse(analysis.uncertainties_json),
          status: analysis.status,
          assertions: preferences,
          valueStances,
        }
      : null,
  };
}

export async function confirmUnderstanding(
  env: Env,
  ownerUserId: string,
  entryId: string,
  snapshotId: string,
): Promise<void> {
  const target = await first<{ id: string; base_snapshot_id: string | null }>(
    env.DB.prepare(
      `SELECT s.id,s.base_snapshot_id FROM character_understanding_snapshots s JOIN entry_revisions er ON er.representation_id=s.representation_id JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number WHERE s.id=? AND s.owner_user_id=? AND e.id=? AND e.status='understanding_review'`,
    ).bind(snapshotId, ownerUserId, entryId),
  );
  if (!target) throw new Error("UNDERSTANDING_REVIEW_NOT_FOUND");
  const now = nowIso();
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
    ).bind(now, entryId, ownerUserId),
    env.DB.prepare(
      `UPDATE jobs SET status='queued',current_step='preferenceAnalysis',progress_current=8,updated_at=?,revision=revision+1 WHERE owner_user_id=? AND target_type='entry' AND target_id=?`,
    ).bind(now, ownerUserId, entryId),
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
}
