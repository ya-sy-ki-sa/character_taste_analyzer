import type { GenerationBrief } from "../../../shared/contracts/generation-brief";
import { all } from "../../lib/db";
import { GENERATION_PROMPT_VERSION } from "../../llm/prompts/generation";
import type { Env, GenerationWorkflowParams } from "../../types";
import * as repository from "./repositories/checkpoints";
import { candidateSchemasForBrief, validationSchemaForBrief } from "./schemas";
import type { CandidateResult } from "./types";
import { reconcileGenerationValidation } from "./validation";

/** Reuse only complete, validated candidates from the same brief and prompt version. */
export async function loadCandidateCheckpoints(env: Env, params: GenerationWorkflowParams, brief: GenerationBrief) {
  const rows = await all<{
    id: string;
    ordinal: number;
    character_json: string;
    validation_json: string;
    model_run_metadata_id: string;
    prompt_version: string;
  }>(
    repository.selectCandidates(env.DB, [
      params.generationRequestId,
      params.ownerUserId,
      params.analysisDomain,
      brief.briefId,
    ]),
  );
  const ids = brief.preferenceSelections.map((item) => item.profileSnapshotItemId);
  const schemas = candidateSchemasForBrief(brief.briefId, ids);
  const schema = params.analysisDomain === "dark" ? schemas.dark : schemas.standard;
  const checkpoints = new Map<number, Omit<CandidateResult, "similarity">>();
  for (const row of rows) {
    if (!row.prompt_version.endsWith(`/${GENERATION_PROMPT_VERSION}`)) continue;
    let character: unknown, validation: unknown;
    try {
      character = JSON.parse(row.character_json);
      validation = JSON.parse(row.validation_json);
    } catch {
      continue;
    }
    const candidate = schema.safeParse(character);
    const report = validationSchemaForBrief(ids).safeParse(validation);
    if (!candidate.success || !report.success) continue;
    const reconciled = reconcileGenerationValidation(brief, candidate.data, report.data);
    if (!reconciled.passed) continue;
    checkpoints.set(row.ordinal, {
      id: row.id,
      ordinal: row.ordinal,
      candidate: candidate.data,
      report: reconciled,
      modelRunId: row.model_run_metadata_id,
      comparison: { coherence: "", preferenceFit: "", difference: "", tradeoffs: [] },
    });
  }
  return checkpoints;
}
