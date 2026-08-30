import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type RepairDraft = {
  registrationType: "existing" | "customized_existing" | "original";
  workTitle?: string;
  baseCharacterName?: string;
  characterName: string;
  mediaType?: string;
  representationType?: string;
  customizationDescription?: string;
  characterBasicInfo?: string;
  preferenceContext?: string;
  knownScope?: string;
  referenceMaterial?: string;
  sourceText?: string;
  userCharacterView?: string;
  preference: {
    likedReasons?: string;
    dislikedReasons?: string;
    responseChannels?: string[];
    valueStanceNote?: string;
  };
};

type RepairSource = { pointer: string; label: string; text: string };

function canonicalEntryInputPointer(pointer: string | null | undefined): string | null {
  if (!pointer) return null;
  let canonical = pointer.trim();
  if (!canonical.startsWith("/")) canonical = `/${canonical}`;
  for (const wrapper of ["/登録情報", "/input", "/entry"]) {
    if (canonical.startsWith(`${wrapper}/`)) {
      canonical = canonical.slice(wrapper.length);
      break;
    }
  }
  return canonical;
}

function entryInputSources(draft: RepairDraft): RepairSource[] {
  const preferenceContext = draft.preferenceContext ?? draft.knownScope;
  const referenceMaterial = draft.referenceMaterial ?? draft.sourceText;
  return [
    draft.registrationType === "original"
      ? null
      : { pointer: "/workTitle", label: "作品名", text: draft.workTitle ?? "" },
    draft.registrationType === "customized_existing"
      ? {
          pointer: "/baseCharacterName",
          label: "既成キャラクター名",
          text: draft.baseCharacterName ?? draft.characterName,
        }
      : null,
    { pointer: "/characterName", label: "キャラクター名", text: draft.characterName },
    draft.registrationType === "original" || !draft.mediaType
      ? null
      : { pointer: "/mediaType", label: "媒体種別", text: draft.mediaType },
    draft.registrationType === "customized_existing" && draft.representationType
      ? { pointer: "/representationType", label: "改変種別", text: draft.representationType }
      : null,
    draft.registrationType === "customized_existing" && draft.customizationDescription
      ? { pointer: "/customizationDescription", label: "改変内容", text: draft.customizationDescription }
      : null,
    draft.registrationType === "original" && draft.characterBasicInfo
      ? { pointer: "/characterBasicInfo", label: "キャラクター基本情報", text: draft.characterBasicInfo }
      : null,
    preferenceContext ? { pointer: "/preferenceContext", label: "対象範囲・場面", text: preferenceContext } : null,
    referenceMaterial ? { pointer: "/referenceMaterial", label: "追加の参考情報", text: referenceMaterial } : null,
    draft.userCharacterView
      ? { pointer: "/userCharacterView", label: "ユーザーのキャラクター観", text: draft.userCharacterView }
      : null,
    draft.preference.likedReasons
      ? { pointer: "/preference/likedReasons", label: "好きな理由", text: draft.preference.likedReasons }
      : null,
    draft.preference.dislikedReasons
      ? { pointer: "/preference/dislikedReasons", label: "苦手な理由", text: draft.preference.dislikedReasons }
      : null,
    {
      pointer: "/preference/responseChannels",
      label: "反応チャネル",
      text: JSON.stringify(draft.preference.responseChannels ?? []),
    },
    draft.preference.valueStanceNote
      ? { pointer: "/preference/valueStanceNote", label: "価値スタンス", text: draft.preference.valueStanceNote }
      : null,
  ].filter((source): source is RepairSource => source !== null && source.text.length > 0);
}

const databasePath = process.env.LOCAL_D1_PATH;
if (!databasePath) throw new Error("LOCAL_D1_PATH is required");

const database = new DatabaseSync(resolve(databasePath));
database.exec("PRAGMA foreign_keys=ON");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function entryTitle(draft: RepairDraft): string {
  return draft.registrationType === "original" ? draft.characterName : `${draft.workTitle} / ${draft.characterName}`;
}

type RevisionRow = {
  id: string;
  owner_user_id: string;
  source_set_version_id: string;
  registration_payload_json: string;
};

type FragmentRow = {
  id: string;
  locator_json: string;
  text_content: string;
};

type InvalidEvidenceRow = {
  id: string;
  entry_revision_id: string;
  excerpt_text: string | null;
  user_input_path: string | null;
};

const revisions = database
  .prepare(`
    SELECT er.id, e.owner_user_id, er.source_set_version_id, er.registration_payload_json
    FROM user_character_entries e
    JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number
    WHERE e.deleted_at IS NULL AND er.source_set_version_id IS NOT NULL
    ORDER BY er.created_at,er.id
  `)
  .all() as unknown as RevisionRow[];

const fragmentsByRevision = new Map<string, Map<string, FragmentRow>>();
let insertedSources = 0;
let repairedEvidence = 0;
const now = new Date().toISOString();

database.exec("BEGIN IMMEDIATE");
try {
  for (const revision of revisions) {
    const draft = JSON.parse(revision.registration_payload_json) as RepairDraft;
    const inputSources = entryInputSources(draft);
    const existing = database
      .prepare(`
        SELECT sf.id,sf.locator_json,sf.text_content
        FROM source_set_items ssi
        JOIN source_fragments sf ON sf.source_document_revision_id=ssi.source_document_revision_id
        WHERE ssi.source_set_version_id=?
        ORDER BY ssi.priority,sf.ordinal
      `)
      .all(revision.source_set_version_id) as unknown as FragmentRow[];
    const byPointer = new Map<string, FragmentRow>();
    for (const fragment of existing) {
      const locator = JSON.parse(fragment.locator_json) as { pointer?: string };
      const pointer = canonicalEntryInputPointer(locator.pointer);
      if (pointer) byPointer.set(pointer, fragment);
    }
    let priority = Number(
      (
        database
          .prepare("SELECT COALESCE(MAX(priority),0) AS value FROM source_set_items WHERE source_set_version_id=?")
          .get(revision.source_set_version_id) as { value: number }
      ).value,
    );
    for (const source of inputSources) {
      const current = byPointer.get(source.pointer);
      if (current?.text_content === source.text) continue;
      const documentId = randomUUID();
      const sourceRevisionId = randomUUID();
      const fragmentId = randomUUID();
      const sourceHash = hash(source.text);
      priority += 1;
      database
        .prepare(
          `INSERT INTO source_documents
             (id,owner_user_id,title,source_type,visibility,citation_json,rights_basis,
              active_revision_number,revision,created_at,updated_at)
           VALUES (?,?,?,'user_text','private',?,'user_supplied',1,1,?,?)`,
        )
        .run(
          documentId,
          revision.owner_user_id,
          `${entryTitle(draft)} ${source.label}`,
          JSON.stringify({ inputPointer: source.pointer }),
          now,
          now,
        );
      database
        .prepare(
          `INSERT INTO source_document_revisions
             (id,source_document_id,revision_number,inline_text,mime_type,byte_size,content_hash,
              upload_status,extraction_status,finalized_at,created_at)
           VALUES (?,?,1,?,'text/plain',?,?,'finalized','ready',?,?)`,
        )
        .run(
          sourceRevisionId,
          documentId,
          source.text,
          new TextEncoder().encode(source.text).byteLength,
          sourceHash,
          now,
          now,
        );
      database
        .prepare(
          `INSERT INTO source_fragments
             (id,source_document_revision_id,ordinal,locator_json,text_content,content_hash,token_estimate,created_at)
           VALUES (?,?,0,?,?,?,?,?)`,
        )
        .run(
          fragmentId,
          sourceRevisionId,
          JSON.stringify({ type: "json_pointer", pointer: source.pointer }),
          source.text,
          sourceHash,
          Math.ceil(source.text.length / 3),
          now,
        );
      database
        .prepare(
          `INSERT INTO source_set_items
             (source_set_version_id,source_document_revision_id,priority,usage_type)
           VALUES (?,?,?,'user_definition')`,
        )
        .run(revision.source_set_version_id, sourceRevisionId, priority);
      const fragment = {
        id: fragmentId,
        locator_json: JSON.stringify({ type: "json_pointer", pointer: source.pointer }),
        text_content: source.text,
      };
      byPointer.set(source.pointer, fragment);
      insertedSources += 1;
    }
    database
      .prepare("UPDATE source_set_versions SET content_hash=? WHERE id=?")
      .run(
        hash(JSON.stringify(inputSources.map(({ pointer, text }) => ({ pointer, text })))),
        revision.source_set_version_id,
      );
    fragmentsByRevision.set(revision.id, byPointer);
  }

  const invalidEvidence = database
    .prepare(`
      SELECT ef.id,r.entry_revision_id,ef.excerpt_text,ef.user_input_path
      FROM evidence_fragments ef
      JOIN character_assertions a ON ef.owner_type='character_assertion' AND a.id=ef.owner_id
      JOIN character_understanding_snapshots s ON s.id=a.snapshot_id
      JOIN character_understanding_runs r ON r.id=s.understanding_run_id
      WHERE ef.verification_status='invalid'
      UNION ALL
      SELECT ef.id,a.entry_revision_id,ef.excerpt_text,ef.user_input_path
      FROM evidence_fragments ef
      JOIN preference_assertions a ON ef.owner_type='preference_assertion' AND a.id=ef.owner_id
      WHERE ef.verification_status='invalid'
      UNION ALL
      SELECT ef.id,r.entry_revision_id,ef.excerpt_text,ef.user_input_path
      FROM evidence_fragments ef
      JOIN value_stance_assertions a ON ef.owner_type='value_stance_assertion' AND a.id=ef.owner_id
      JOIN analysis_runs r ON r.id=a.analysis_run_id
      WHERE ef.verification_status='invalid'
    `)
    .all() as unknown as InvalidEvidenceRow[];

  for (const evidence of invalidEvidence) {
    const quote = evidence.excerpt_text?.trim();
    const sources = fragmentsByRevision.get(evidence.entry_revision_id);
    if (!quote || !sources) continue;
    const pointer = canonicalEntryInputPointer(evidence.user_input_path);
    let source = pointer ? sources.get(pointer) : undefined;
    if (!source?.text_content.includes(quote)) {
      const matches = [...sources.entries()].filter(([, item]) => item.text_content.includes(quote));
      if (matches.length !== 1) continue;
      source = matches[0][1];
    }
    const locator = JSON.parse(source.locator_json) as { pointer?: string };
    const canonicalPointer = canonicalEntryInputPointer(locator.pointer);
    const quoteStart = source.text_content.indexOf(quote);
    if (!canonicalPointer || quoteStart < 0) continue;
    database
      .prepare(`
        UPDATE evidence_fragments
        SET source_fragment_id=?,evidence_origin='user_input',quote_start=?,quote_end=?,quote_hash=?,
            excerpt_text=?,user_input_path=?,verification_status='verified_quote',provenance_schema_version='2'
        WHERE id=? AND verification_status='invalid'
      `)
      .run(source.id, quoteStart, quoteStart + quote.length, hash(quote), quote, canonicalPointer, evidence.id);
    repairedEvidence += 1;
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

console.log(JSON.stringify({ revisions: revisions.length, insertedSources, repairedEvidence }));
