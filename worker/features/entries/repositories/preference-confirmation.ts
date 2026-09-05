import type { AnalysisDomain } from "../../../../shared/analysis-domain";
import type { PreferenceReviewMutation } from "../../../../shared/contracts/reviews";

type ContentReview = Exclude<PreferenceReviewMutation, { action: "set_response_channel" }>;
export type ConfirmationWrite = {
  changedId: string;
  owner: string;
  domain: AnalysisDomain;
  runId: string;
  revisionId: string;
  identityId: string;
  representationId: string;
  input: ContentReview;
  contextJson: string;
  attributeId: string | null;
  rawId: string;
  normalizedLabel: string;
  targetType: string;
  mappingId: string;
  oldRawId: string | null;
  sourceId: string;
  evidenceId: string;
  writeToken: string;
  text: string;
  hash: string;
  byteLength: number;
  locatorJson: string;
  citationJson: string;
  pointer: string;
  now: string;
};

/** D1 serializes the batch. The source insert admits one writer; all dependent writes
 * require that invocation's token, so losing updates/retries leave no orphan records. */
export function confirmationStatements(db: D1Database, write: ConfirmationWrite): D1PreparedStatement[] {
  const w = write;
  const preference = w.input.action === "add_preference" || w.input.action === "update_preference";
  const table = preference ? "preference_assertions" : "value_stance_assertions";
  const ownerType = preference ? "preference_assertion" : "value_stance_assertion";
  const targetId = "targetId" in w.input ? w.input.targetId : null;
  const gate = `EXISTS (SELECT 1 FROM sources WHERE id=? AND owner_user_id=? AND json_extract(locator_json,'$.writeToken')=?)`;
  const guarded = (sql: string, bindings: unknown[]) =>
    db.prepare(sql).bind(...bindings, w.sourceId, w.owner, w.writeToken);
  const statements = [
    db
      .prepare(`INSERT INTO sources
    (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at)
    SELECT ?,?,'確認画面での本人の申告','user_text',?,'user_provided','text/plain',?,?,?,?,?,?,?
    FROM analysis_runs ar JOIN entry_revisions er ON er.id=ar.entry_revision_id
    JOIN user_character_entries e ON e.id=er.entry_id AND e.active_revision_number=er.revision_number
    WHERE ar.id=? AND ar.owner_user_id=? AND e.owner_user_id=? AND e.analysis_domain=?
      AND ar.status='succeeded' AND e.status='analysis_review'
      AND ar.run_generation=(SELECT MAX(latest.run_generation) FROM analysis_runs latest
        WHERE latest.entry_revision_id=ar.entry_revision_id AND latest.owner_user_id=ar.owner_user_id AND latest.status='succeeded')
      AND (? IS NULL OR EXISTS (SELECT 1 FROM ${table} old WHERE old.id=? AND old.owner_user_id=ar.owner_user_id
        AND old.analysis_run_id=ar.id AND old.status IN ('proposed','corrected')))
      AND NOT EXISTS (SELECT 1 FROM sources WHERE id=?)
      AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id=?)
    `)
      .bind(
        w.sourceId,
        w.owner,
        w.citationJson,
        w.byteLength,
        w.hash,
        w.locatorJson,
        w.text,
        Math.ceil(w.text.length / 3),
        w.now,
        w.now,
        w.runId,
        w.owner,
        w.owner,
        w.domain,
        targetId,
        targetId,
        w.sourceId,
        w.changedId,
      ),
  ];
  if (w.input.action === "add_preference" || w.input.action === "update_preference") {
    if (w.oldRawId)
      statements.push(
        guarded(
          `UPDATE attribute_mappings SET mapping_status='rejected',decided_by_user_id=?,decided_at=?
      WHERE raw_mention_id=? AND mapping_status IN ('candidate','accepted','unmapped') AND ${gate}`,
          [w.owner, w.now, w.oldRawId],
        ),
      );
    statements.push(
      guarded(
        `INSERT INTO raw_attribute_mentions
        (id,owner_user_id,source_type,source_ref_type,source_ref_id,raw_label,locale,normalized_label,created_at)
        SELECT ?,?,'user','preference_assertion',?,?,'ja',?,? WHERE ${gate}`,
        [w.rawId, w.owner, w.changedId, w.input.rawLabel, w.normalizedLabel, w.now],
      ),
      guarded(
        `INSERT INTO attribute_mappings
        (id,raw_mention_id,attribute_definition_id,mapping_status,mapping_method,confidence,decided_by_user_id,created_at,decided_at)
        SELECT ?,?,?,?,'user',1,?,?,? WHERE ${gate}`,
        [w.mappingId, w.rawId, w.attributeId, w.attributeId ? "accepted" : "unmapped", w.owner, w.now, w.now],
      ),
      guarded(
        `INSERT INTO preference_assertions
        (id,owner_user_id,analysis_run_id,entry_revision_id,character_identity_id,representation_id,attribute_definition_id,raw_mention_id,
        analysis_domain,polarity,response_channel,strength,explicitness,confidence,context_json,status,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'user_confirmed',1,?,'corrected',? WHERE ${gate}`,
        [
          w.changedId,
          w.owner,
          w.runId,
          w.revisionId,
          w.identityId,
          w.representationId,
          w.attributeId,
          w.rawId,
          w.domain,
          w.input.polarity,
          w.input.responseChannel,
          w.input.strength,
          w.contextJson,
          w.now,
        ],
      ),
    );
  } else {
    statements.push(
      guarded(
        `INSERT INTO value_stance_assertions
      (id,owner_user_id,analysis_run_id,target_type,target_ref,stance,orientation,scope_json,explicitness,confidence,status,created_at)
      SELECT ?,?,?,?,?,?,?,?,'user_confirmed',1,'corrected',? WHERE ${gate}`,
        [
          w.changedId,
          w.owner,
          w.runId,
          w.targetType,
          w.input.targetRef,
          w.input.stance,
          w.input.orientation,
          w.contextJson,
          w.now,
        ],
      ),
    );
  }
  statements.push(
    guarded(
      `INSERT INTO evidence_fragments
    (id,owner_user_id,owner_type,owner_id,source_id,evidence_origin,support_type,quote_start,quote_end,quote_hash,
    excerpt_text,user_input_path,verification_status,inference_type,confidence,created_at)
    SELECT ?,?,?,?,?,'review','supports',0,?,?,?,?, 'verified_quote','direct',1,? WHERE ${gate}`,
      [w.evidenceId, w.owner, ownerType, w.changedId, w.sourceId, w.text.length, w.hash, w.text, w.pointer, w.now],
    ),
  );
  if (targetId)
    statements.push(
      guarded(
        `UPDATE ${table} SET status='superseded',superseded_by_id=?
    WHERE id=? AND owner_user_id=? AND analysis_run_id=? AND status IN ('proposed','corrected') AND ${gate}`,
        [w.changedId, targetId, w.owner, w.runId],
      ),
    );
  return statements;
}
