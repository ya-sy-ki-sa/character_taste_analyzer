import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import { localizeAttributeReference, localizeUnderstandingSummary } from "../profile/attribute-labels";
import { loadEvidenceViews } from "./evidence";
import * as repository from "./repositories/review";

export async function loadEntryReview(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain, entryId: string) {
  const entry = await first<{
    status: string;
    registration_type: string;
    registration_payload_json: string;
    revision_id: string;
    representation_id: string;
  }>(repository.selectUserCharacterEntries(env.DB, [entryId, ownerUserId, analysisDomain]));
  if (!entry) return null;
  const snapshot = await first<{
    id: string;
    base_snapshot_id: string | null;
    source_assessment_json: string;
    summary_json: string;
    uncertainties_json: string;
    overall_confidence: number;
    status: string;
  }>(repository.selectCharacterUnderstandingSnapshots(env.DB, [ownerUserId, entry.representation_id]));
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
      }>(repository.selectCharacterAssertions(env.DB, [snapshot.id]))
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
      }>(repository.selectCustomizationDeltas(env.DB, [snapshot.id]))
    : [];
  const baseSnapshot = snapshot?.base_snapshot_id
    ? await first<{
        id: string;
        source_assessment_json: string;
        summary_json: string;
        uncertainties_json: string;
        overall_confidence: number;
        status: string;
      }>(repository.selectCharacterUnderstandingSnapshots2(env.DB, [snapshot.base_snapshot_id, ownerUserId]))
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
      }>(repository.selectCharacterAssertions2(env.DB, [baseSnapshot.id]))
    : [];
  const analysis = await first<{
    id: string;
    summary_json: string;
    uncertainties_json: string;
    status: string;
    quality_context_json: string;
  }>(repository.selectAnalysisRuns(env.DB, [ownerUserId, entry.revision_id]));
  const refinement = analysis
    ? await first<{ id: string; mode: string; context_json: string; hypotheses_json: string | null }>(
        repository.selectPreferenceRefinements(env.DB, [ownerUserId, entry.revision_id]),
      )
    : null;
  const hypothesisPreview =
    refinement?.mode === "hypotheses" && JSON.parse(refinement.context_json).baseAnalysisRunId === analysis?.id
      ? {
          id: refinement.id,
          candidates: refinement.hypotheses_json
            ? (JSON.parse(
                refinement.hypotheses_json,
              ) as import("../../../shared/contracts/refinement").PreferenceHypothesis[])
            : null,
        }
      : null;
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
      }>(repository.selectPreferenceAssertions(env.DB, [analysis.id]))
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
      }>(repository.selectValueStanceAssertions(env.DB, [analysis.id]))
    : [];
  const darkScopeAssessment =
    analysisDomain === "dark"
      ? await first<{ id: string; verdict: string; status: string; assessment_json: string }>(
          repository.selectDarkScopeAssessments(env.DB, [ownerUserId, entry.revision_id]),
        )
      : null;
  const darkBaseline =
    analysisDomain === "dark"
      ? await first<{ id: string; baseline_json: string }>(
          repository.selectDarkBaselineSnapshots(env.DB, [ownerUserId, entry.revision_id]),
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
        }>(repository.selectDarkTransformationDeltas(env.DB, [ownerUserId, snapshot.id]))
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
        ? all<{ stable_key: string; label: string }>(repository.selectAttributeDefinitions(env.DB, [analysisDomain]))
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
          hypothesisPreview,
          qualityContext: JSON.parse(analysis.quality_context_json),
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
