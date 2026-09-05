import type { AnyEntryDraft } from "../../../shared/contracts/entries";

export function registrationTitle(draft: AnyEntryDraft): string {
  return draft.registrationType === "original" ? draft.characterName : `${draft.workTitle} / ${draft.characterName}`;
}
