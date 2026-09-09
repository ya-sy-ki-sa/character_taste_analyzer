import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { prepareModelRun } from "../../llm/model-runs";
import { GENERATION_PROMPT_VERSION } from "../../llm/prompts/generation";
import type { LlmRunMetadata } from "../../llm/types";
import type { Env } from "../../types";

export async function persistModelRun(
  env: Env,
  ownerUserId: string,
  inputHash: string,
  output: unknown,
  metadata: LlmRunMetadata,
  operation = "character_generation",
  analysisDomain: AnalysisDomain = "standard",
): Promise<string> {
  operation = metadata.operation ?? operation;
  const run = await prepareModelRun(env.DB, {
    ownerUserId,
    operation,
    inputHash,
    output,
    metadata,
    analysisDomain,
    promptVersion: `${operation}/${GENERATION_PROMPT_VERSION}`,
    schemaVersion: "1.0",
  });
  await run.statement.run();
  return run.id;
}
