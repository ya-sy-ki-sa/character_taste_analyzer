import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { type AnyEntryDraft, anyEntryDraftSchema } from "../../../shared/contracts/entries";
import { all, first } from "../../lib/db";
import type { LlmProvider } from "../../llm/types";
import type { Env } from "../../types";
import * as repository from "./repositories/context";
import type { AttributeRow, EntryContext } from "./types";

export async function loadEntry(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  entryId: string,
  llm: LlmProvider,
): Promise<EntryContext> {
  const row = await first<{
    id: string;
    owner_user_id: string;
    analysis_domain: AnalysisDomain;
    registration_type: AnyEntryDraft["registrationType"];
    revision_id: string;
    representation_id: string;
    base_representation_id: string | null;
    character_identity_id: string;
    source_set_id: string | null;
    registration_payload_json: string;
    source_id: string | null;
  }>(repository.selectSourceSetItems(env.DB, [entryId, ownerUserId, analysisDomain]));
  if (!row) throw new Error("ENTRY_NOT_FOUND");
  return {
    llm,
    entryId: row.id,
    ownerUserId: row.owner_user_id,
    analysisDomain: row.analysis_domain,
    registrationType: row.registration_type,
    entryRevisionId: row.revision_id,
    representationId: row.representation_id,
    baseRepresentationId: row.base_representation_id,
    characterIdentityId: row.character_identity_id,
    sourceSetId: row.source_set_id,
    sourceId: row.source_id,
    payload: anyEntryDraftSchema.parse(JSON.parse(row.registration_payload_json)),
  };
}

export async function loadOntology(env: Env, analysisDomain: AnalysisDomain): Promise<AttributeRow[]> {
  return all<AttributeRow>(repository.selectAttributeDefinitions(env.DB, [analysisDomain]));
}

export function ontologyPrompt(rows: AttributeRow[]): string {
  return rows.map((row) => `${row.stable_key}: ${row.label} [${row.category}]`).join("\n");
}
