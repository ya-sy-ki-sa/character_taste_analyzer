import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import {
  entryBaseCharacterName,
  entryInputSources,
  entryReferenceMaterial,
  entryScopeText,
} from "../../../shared/entry-input";
import { sha256Hex } from "../../lib/crypto";
import { registrationTitle } from "./presentation";
import * as repository from "./repositories/input";

export function representationStatements(
  db: D1Database,
  {
    ownerUserId,
    draft,
    identityId,
    representationId,
    baseRepresentationId,
    now,
  }: {
    ownerUserId: string;
    draft: AnyEntryDraft;
    identityId: string;
    representationId: string;
    baseRepresentationId: string | null;
    now: string;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const referenceMaterial = entryReferenceMaterial(draft);
  if (baseRepresentationId && draft.registrationType === "customized_existing")
    statements.push(
      repository.insertBaseRepresentation(db, [
        baseRepresentationId,
        identityId,
        ownerUserId,
        `基本像: ${draft.workTitle} / ${entryBaseCharacterName(draft)}`,
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
    repository.insertTargetRepresentation(db, [
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
  return statements;
}

export async function prepareInputSources(
  db: D1Database,
  {
    ownerUserId,
    draft,
    sourceSetId,
    now,
    createDocumentId,
  }: {
    ownerUserId: string;
    draft: AnyEntryDraft;
    sourceSetId: string;
    now: string;
    createDocumentId(ordinal: number): string | Promise<string>;
  },
): Promise<D1PreparedStatement[]> {
  const sources = entryInputSources(draft);
  const sourceSetHash = await sha256Hex(JSON.stringify(sources.map(({ pointer, text }) => ({ pointer, text }))));
  const statements = [repository.insertInputSourceSet(db, [sourceSetId, ownerUserId, sourceSetHash, now, now])];
  for (const [ordinal, source] of sources.entries()) {
    const documentId = await createDocumentId(ordinal);
    const hash = await sha256Hex(source.text);
    statements.push(
      repository.insertInputSource(db, [
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
      repository.insertInputSourceSetItem(db, [sourceSetId, documentId, ordinal + 1]),
    );
  }
  return statements;
}
