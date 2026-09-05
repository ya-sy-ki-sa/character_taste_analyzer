import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type {
  AnyEntryDraft,
  AnyEntrySubmission,
  DarkContext,
  IdentityResolution,
} from "../../../shared/contracts/entries";
import type { RegistrationType } from "../../../shared/contracts/taxonomy";
import type { DarkResponseChannel } from "../../../shared/dark-response-channels";
import { entryBaseCharacterName, entryPreferenceContext, entryReferenceMaterial } from "../../../shared/entry-input";
import type { ResponseChannel } from "../../../shared/response-channels";

export type FormState = {
  registrationType: RegistrationType;
  workTitle: string;
  baseCharacterName: string;
  characterName: string;
  mediaType: string;
  preferenceContext: string;
  characterBasicInfo: string;
  referenceMaterial: string;
  userCharacterView: string;
  representationType: "facet" | "scene_state" | "user_interpretation" | "transformative" | "alternate_setting";
  customizationDescription: string;
  likedReasons: string;
  dislikedReasons: string;
  responseChannels: Array<ResponseChannel | DarkResponseChannel>;
  valueStanceNote: string;
  focusDescription: string;
  archetypeHints: DarkContext["archetypeHints"];
  beforeState: string;
  transitionTrigger: string;
  controllerOrInfluence: string;
  controlMechanism: string;
  awarenessAndResistance: string;
  relationshipChange: string;
  responsibilityNote: string;
  desiredOutcome: string;
  contentBoundaries: string;
};

export function emptyForm(domain: AnalysisDomain): FormState {
  return {
    registrationType: "existing",
    workTitle: "",
    baseCharacterName: "",
    characterName: "",
    mediaType: "",
    preferenceContext: "",
    characterBasicInfo: "",
    referenceMaterial: "",
    userCharacterView: "",
    representationType: "user_interpretation",
    customizationDescription: "",
    likedReasons: "",
    dislikedReasons: "",
    responseChannels: domain === "dark" ? ["dark_character_liking"] : ["person_liking"],
    valueStanceNote: "",
    focusDescription: "",
    archetypeHints: [],
    beforeState: "",
    transitionTrigger: "",
    controllerOrInfluence: "",
    controlMechanism: "",
    awarenessAndResistance: "",
    relationshipChange: "",
    responsibilityNote: "",
    desiredOutcome: "",
    contentBoundaries: "",
  };
}

export function formStateFromDraft(draft: AnyEntryDraft): FormState {
  return {
    registrationType: draft.registrationType,
    workTitle: draft.registrationType === "original" ? "" : draft.workTitle,
    baseCharacterName: draft.registrationType === "customized_existing" ? entryBaseCharacterName(draft) : "",
    characterName: draft.characterName,
    mediaType: draft.registrationType === "original" ? "" : (draft.mediaType ?? ""),
    preferenceContext: entryPreferenceContext(draft) ?? "",
    characterBasicInfo: draft.registrationType === "original" ? draft.characterBasicInfo : "",
    referenceMaterial: entryReferenceMaterial(draft) ?? "",
    userCharacterView: draft.userCharacterView ?? "",
    representationType:
      draft.registrationType === "customized_existing" ? draft.representationType : "user_interpretation",
    customizationDescription: draft.registrationType === "customized_existing" ? draft.customizationDescription : "",
    likedReasons: draft.preference.likedReasons ?? "",
    dislikedReasons: draft.preference.dislikedReasons ?? "",
    responseChannels: draft.preference.responseChannels,
    valueStanceNote: draft.preference.valueStanceNote ?? "",
    focusDescription: "darkContext" in draft ? draft.darkContext.focusDescription : "",
    archetypeHints: "darkContext" in draft ? draft.darkContext.archetypeHints : [],
    beforeState: "darkContext" in draft ? (draft.darkContext.beforeState ?? "") : "",
    transitionTrigger: "darkContext" in draft ? (draft.darkContext.transitionTrigger ?? "") : "",
    controllerOrInfluence: "darkContext" in draft ? (draft.darkContext.controllerOrInfluence ?? "") : "",
    controlMechanism: "darkContext" in draft ? (draft.darkContext.controlMechanism ?? "") : "",
    awarenessAndResistance: "darkContext" in draft ? (draft.darkContext.awarenessAndResistance ?? "") : "",
    relationshipChange: "darkContext" in draft ? (draft.darkContext.relationshipChange ?? "") : "",
    responsibilityNote: "darkContext" in draft ? (draft.darkContext.responsibilityNote ?? "") : "",
    desiredOutcome: "darkContext" in draft ? (draft.darkContext.desiredOutcome ?? "") : "",
    contentBoundaries: "darkContext" in draft ? (draft.darkContext.contentBoundaries ?? "") : "",
  };
}

export function entrySubmissionFromForm(
  form: FormState,
  identityResolution: IdentityResolution,
  domain: AnalysisDomain,
): AnyEntrySubmission {
  const common = {
    characterName: form.characterName,
    preferenceContext: form.preferenceContext || undefined,
    referenceMaterial: form.referenceMaterial || undefined,
    userCharacterView: form.userCharacterView || undefined,
    preference: {
      likedReasons: form.likedReasons || undefined,
      dislikedReasons: form.dislikedReasons || undefined,
      responseChannels: form.responseChannels,
      valueStanceNote: form.valueStanceNote || undefined,
    },
  };
  const domainFields =
    domain === "dark"
      ? {
          darkContext: {
            focusDescription: form.focusDescription,
            archetypeHints: form.archetypeHints,
            beforeState: form.beforeState || undefined,
            transitionTrigger: form.transitionTrigger || undefined,
            controllerOrInfluence: form.controllerOrInfluence || undefined,
            controlMechanism: form.controlMechanism || undefined,
            awarenessAndResistance: form.awarenessAndResistance || undefined,
            relationshipChange: form.relationshipChange || undefined,
            responsibilityNote: form.responsibilityNote || undefined,
            desiredOutcome: form.desiredOutcome || undefined,
            contentBoundaries: form.contentBoundaries || undefined,
          },
        }
      : {};
  if (form.registrationType === "original")
    return {
      ...common,
      ...domainFields,
      registrationType: "original",
      characterBasicInfo: form.characterBasicInfo,
    } as AnyEntrySubmission;
  if (form.registrationType === "existing")
    return {
      ...common,
      ...domainFields,
      registrationType: "existing",
      workTitle: form.workTitle,
      mediaType: form.mediaType || undefined,
      identityResolution,
    } as AnyEntrySubmission;
  return {
    ...common,
    ...domainFields,
    registrationType: "customized_existing",
    workTitle: form.workTitle,
    baseCharacterName: form.baseCharacterName,
    mediaType: form.mediaType || undefined,
    representationType: form.representationType,
    customizationDescription: form.customizationDescription,
    identityResolution,
  } as AnyEntrySubmission;
}

export function identityCharacterName(form: FormState): string {
  return form.registrationType === "customized_existing" ? form.baseCharacterName : form.characterName;
}
