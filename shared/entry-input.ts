import type { AnyEntryDraft, DarkEntryDraft } from "./contracts/entries";

export function isDarkEntryDraft(draft: AnyEntryDraft): draft is DarkEntryDraft {
  return "darkContext" in draft;
}

export function entryPreferenceContext(draft: AnyEntryDraft): string | undefined {
  return draft.preferenceContext;
}

export function entryScopeText(draft: AnyEntryDraft): string {
  return entryPreferenceContext(draft) ?? "キャラクター全体";
}

export function entryReferenceMaterial(draft: AnyEntryDraft): string | undefined {
  return draft.referenceMaterial;
}

export function entryBaseCharacterName(draft: AnyEntryDraft): string {
  if (draft.registrationType !== "customized_existing") return draft.characterName;
  return draft.baseCharacterName;
}

export type EntryInputSource = {
  pointer: string;
  label: string;
  text: string;
};

export function canonicalEntryInputPointer(pointer: string | null | undefined): string | null {
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

export function entryInputSources(draft: AnyEntryDraft): EntryInputSource[] {
  const referenceMaterial = entryReferenceMaterial(draft);
  const preferenceContext = entryPreferenceContext(draft);
  return [
    draft.registrationType === "original" ? null : { pointer: "/workTitle", label: "作品名", text: draft.workTitle },
    draft.registrationType === "customized_existing"
      ? { pointer: "/baseCharacterName", label: "既成キャラクター名", text: entryBaseCharacterName(draft) }
      : null,
    { pointer: "/characterName", label: "キャラクター名", text: draft.characterName },
    draft.registrationType === "original" || !draft.mediaType
      ? null
      : { pointer: "/mediaType", label: "媒体種別", text: draft.mediaType },
    draft.registrationType === "customized_existing"
      ? { pointer: "/representationType", label: "改変種別", text: draft.representationType }
      : null,
    draft.registrationType === "customized_existing"
      ? {
          pointer: "/customizationDescription",
          label: "改変内容",
          text: draft.customizationDescription,
        }
      : null,
    draft.registrationType === "original"
      ? { pointer: "/characterBasicInfo", label: "キャラクター基本情報", text: draft.characterBasicInfo }
      : null,
    preferenceContext ? { pointer: "/preferenceContext", label: "対象範囲・場面", text: preferenceContext } : null,
    referenceMaterial ? { pointer: "/referenceMaterial", label: "追加の参考情報", text: referenceMaterial } : null,
    draft.userCharacterView
      ? { pointer: "/userCharacterView", label: "ユーザーのキャラクター観", text: draft.userCharacterView }
      : null,
    isDarkEntryDraft(draft)
      ? {
          pointer: "/darkContext/focusDescription",
          label: "注目するダーク状態",
          text: draft.darkContext.focusDescription,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.beforeState
      ? { pointer: "/darkContext/beforeState", label: "変化前の状態", text: draft.darkContext.beforeState }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.transitionTrigger
      ? { pointer: "/darkContext/transitionTrigger", label: "闇化の契機", text: draft.darkContext.transitionTrigger }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.controllerOrInfluence
      ? {
          pointer: "/darkContext/controllerOrInfluence",
          label: "支配者・影響源",
          text: draft.darkContext.controllerOrInfluence,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.controlMechanism
      ? {
          pointer: "/darkContext/controlMechanism",
          label: "支配・変化の機構",
          text: draft.darkContext.controlMechanism,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.awarenessAndResistance
      ? {
          pointer: "/darkContext/awarenessAndResistance",
          label: "認識・抵抗",
          text: draft.darkContext.awarenessAndResistance,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.relationshipChange
      ? { pointer: "/darkContext/relationshipChange", label: "関係変化", text: draft.darkContext.relationshipChange }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.responsibilityNote
      ? {
          pointer: "/darkContext/responsibilityNote",
          label: "責任の捉え方",
          text: draft.darkContext.responsibilityNote,
        }
      : null,
    isDarkEntryDraft(draft) && draft.darkContext.desiredOutcome
      ? { pointer: "/darkContext/desiredOutcome", label: "望む結末", text: draft.darkContext.desiredOutcome }
      : null,
    draft.preference.likedReasons
      ? { pointer: "/preference/likedReasons", label: "好きな理由", text: draft.preference.likedReasons }
      : null,
    draft.preference.dislikedReasons
      ? { pointer: "/preference/dislikedReasons", label: "苦手な理由", text: draft.preference.dislikedReasons }
      : null,
    {
      pointer: "/preference/responseChannels",
      label: "選択した惹かれ方",
      text: JSON.stringify(draft.preference.responseChannels),
    },
    draft.preference.valueStanceNote
      ? { pointer: "/preference/valueStanceNote", label: "価値スタンス", text: draft.preference.valueStanceNote }
      : null,
  ].filter((item): item is EntryInputSource => item !== null);
}
