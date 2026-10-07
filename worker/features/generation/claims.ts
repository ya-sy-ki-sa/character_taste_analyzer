import { first } from "../../lib/db";
import type { LlmProvider } from "../../llm/types";
import type { Env } from "../../types";
import { selectCurrentAttempt } from "./repositories/fence";
import type { GenerationFence } from "./types";

export async function generationFenceIsCurrent(env: Env, fence: GenerationFence): Promise<boolean> {
  return Boolean(await first<{ ok: number }>(selectCurrentAttempt(env.DB, fence)));
}

export function guardGenerationProvider(env: Env, provider: LlmProvider, fence: GenerationFence): LlmProvider {
  async function assertCurrent() {
    if (!(await generationFenceIsCurrent(env, fence))) throw new Error("GENERATION_ATTEMPT_SUPERSEDED");
  }
  return {
    providerId: provider.providerId,
    async generateStructured(request) {
      await assertCurrent();
      const result = await provider.generateStructured(request);
      // Completed calls keep their immutable usage records. Result/progress writes have SQL fences;
      // the next provider call is stopped here if this attempt has since been replaced.
      return result;
    },
  };
}
