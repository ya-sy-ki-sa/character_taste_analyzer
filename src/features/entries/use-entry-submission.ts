import { type FormEvent, useRef, useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyEntryDraft, IdentityResolution } from "../../../shared/contracts/entries";
import type { IdentityCandidate } from "../../../shared/contracts/entries-response";
import { entryBaseCharacterName } from "../../../shared/entry-input";
import { idempotencyKey } from "../../lib/http";
import { entriesApi } from "./api";
import { entrySubmissionFromForm, type FormState, identityCharacterName } from "./form-state";

export function useEntrySubmission({
  domain,
  form,
  reanalysis,
  onCreated,
}: {
  domain: AnalysisDomain;
  form: FormState;
  reanalysis?: { entryId: string; draft: AnyEntryDraft };
  onCreated(): void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "saving">("idle");
  const inFlight = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const [error, setError] = useState<string>();
  const [candidates, setCandidates] = useState<IdentityCandidate[]>();
  const [selectedIdentityId, setSelectedIdentityId] = useState("new");
  const requiresIdentityResolution =
    form.registrationType !== "original" &&
    (!reanalysis ||
      identityCharacterName(form).trim() !== entryBaseCharacterName(reanalysis.draft).trim() ||
      (reanalysis.draft.registrationType !== "original" &&
        form.workTitle.trim() !== reanalysis.draft.workTitle.trim()));

  function invalidateCandidates() {
    setCandidates(undefined);
    setSelectedIdentityId("new");
    setError(undefined);
  }

  function selectIdentity(value: string) {
    setSelectedIdentityId(value);
    setError(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // State updates alone do not block another submit in the same event batch.
    if (inFlight.current) return;
    inFlight.current = true;
    setError(undefined);
    let failureMessage = reanalysis ? "再分析を開始できませんでした" : "登録できませんでした";
    try {
      let resolvedCandidates = candidates;
      let resolvedIdentityId = selectedIdentityId;
      if (requiresIdentityResolution && resolvedCandidates === undefined) {
        setPhase("checking");
        failureMessage = "同一キャラクター候補を確認できませんでした";
        const result = await entriesApi.identityCandidates(domain, {
          workTitle: form.workTitle,
          characterName: identityCharacterName(form),
          mediaType: form.mediaType || undefined,
        });
        resolvedCandidates = result.candidates;
        resolvedIdentityId = result.candidates.length ? "" : "new";
        setCandidates(resolvedCandidates);
        setSelectedIdentityId(resolvedIdentityId);
        if (resolvedCandidates.length) return;
      }
      if (requiresIdentityResolution && !resolvedIdentityId) {
        setError("既存の同一人物情報を再利用するか、別物として新規登録するか選んでください");
        return;
      }
      const selectedCandidate = resolvedCandidates?.find((item) => item.characterIdentityId === resolvedIdentityId);
      const identityResolution: IdentityResolution = requiresIdentityResolution
        ? selectedCandidate
          ? {
              mode: "reuse",
              workId: selectedCandidate.workId,
              characterIdentityId: selectedCandidate.characterIdentityId,
            }
          : { mode: "new" }
        : reanalysis && reanalysis.draft.registrationType !== "original"
          ? reanalysis.draft.identityResolution
          : { mode: "new" };
      setPhase("saving");
      failureMessage = reanalysis ? "再分析を開始できませんでした" : "登録できませんでした";
      const payload = entrySubmissionFromForm(form, identityResolution, domain);
      // Retain keys for each submitted payload until this form is closed, including retries after edits are undone.
      const signature = JSON.stringify([domain, reanalysis?.entryId, payload]);
      let requestKey = requestKeys.current.get(signature);
      if (!requestKey) {
        requestKey = idempotencyKey();
        requestKeys.current.set(signature, requestKey);
      }
      await (reanalysis
        ? entriesApi.reanalyze(domain, reanalysis.entryId, payload, requestKey)
        : entriesApi.create(domain, payload, requestKey));
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failureMessage);
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  }

  return {
    submitting: phase !== "idle",
    progressLabel: phase === "checking" ? "候補を確認中…" : phase === "saving" ? "保存・開始中…" : undefined,
    error,
    candidates,
    selectedIdentityId,
    selectIdentity,
    invalidateCandidates,
    requiresIdentityResolution,
    submit,
  };
}
