import { app } from "./app";
import { runDailyCleanup } from "./services/cleanup";
import { dispatchPendingOutbox } from "./services/orchestration";
import type { Env } from "./types";

export {
  AccountExportWorkflow,
  CharacterAnalysisWorkflow,
  GenerationWorkflow,
  ProfileRebuildWorkflow,
} from "./workflows";

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, executionCtx: ExecutionContext) {
    executionCtx.waitUntil(dispatchPendingOutbox(env, 50));
    if (controller.cron !== "* * * * *") executionCtx.waitUntil(runDailyCleanup(env));
  },
};
