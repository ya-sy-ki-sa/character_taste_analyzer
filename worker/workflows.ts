import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { processAccountExport } from "./services/exports";
import { processProfileRebuild } from "./services/profile";
import { createDataStoreStrategy } from "./storage/strategy";
import type {
  CharacterAnalysisWorkflowParams,
  Env,
  ExportWorkflowParams,
  GenerationWorkflowParams,
  ProfileRebuildWorkflowParams,
} from "./types";

export class CharacterAnalysisWorkflow extends WorkflowEntrypoint<Env, CharacterAnalysisWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<CharacterAnalysisWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do(
      `character-analysis-${event.payload.stage}`,
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" },
      async () => {
        const strategy = createDataStoreStrategy(this.env);
        if (event.payload.stage === "understanding") await strategy.processCharacterAnalysis(event.payload);
        else await strategy.processPreferenceAnalysis(event.payload);
      },
    );
  }
}

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<GenerationWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do(
      "character-generation",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" },
      async () => createDataStoreStrategy(this.env).processGeneration(event.payload),
    );
  }
}

export class ProfileRebuildWorkflow extends WorkflowEntrypoint<Env, ProfileRebuildWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<ProfileRebuildWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do(
      "profile-graph-rebuild",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" },
      async () => processProfileRebuild(this.env, event.payload),
    );
  }
}

export class AccountExportWorkflow extends WorkflowEntrypoint<Env, ExportWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<ExportWorkflowParams>>, step: WorkflowStep): Promise<void> {
    await step.do("account-export", { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" }, async () =>
      processAccountExport(this.env, event.payload),
    );
  }
}
