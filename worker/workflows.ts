import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { processAnalysis } from "./services/analysis";
import { processGeneration } from "./services/generation";
import type { AnalysisWorkflowParams, Env, GenerationWorkflowParams } from "./types";

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<AnalysisWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do(
      "character-analysis-and-profile-rebuild",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" },
      async () => {
        await processAnalysis(this.env, event.payload);
      },
    );
  }
}

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<GenerationWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do(
      "character-generation",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" },
      async () => {
        await processGeneration(this.env, event.payload);
      },
    );
  }
}
