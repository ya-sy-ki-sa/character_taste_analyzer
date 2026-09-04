import type { Env } from "../types";
import {
  type ModerationInput,
  type ModerationProvider,
  ModerationProviderError,
  type ModerationReason,
  type ModerationResult,
} from "./types";

const REJECTED_CATEGORY_LABELS: Record<string, string> = {
  "illicit/violent": "暴力を伴う違法行為",
  "self-harm/instructions": "自傷行為の助長・手順",
  "sexual/minors": "未成年者に関する性的な内容",
};

type OpenAiModerationPayload = {
  results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
};

export class OpenAiModerationProvider implements ModerationProvider {
  readonly providerId = "openai";

  constructor(private readonly env: Env) {}

  private endpoint(): string {
    if (!this.env.AI_GATEWAY_ACCOUNT_ID || !this.env.AI_GATEWAY_GATEWAY_ID || !this.env.AI_GATEWAY_TOKEN)
      throw new ModerationProviderError("モデレーションのGateway設定が足りません", "MODERATION_CONFIGURATION_INVALID");
    return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(this.env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(this.env.AI_GATEWAY_GATEWAY_ID)}/openai/moderations`;
  }

  async moderate(inputs: ModerationInput[]): Promise<ModerationResult> {
    if (!inputs.length) return { allowed: true, reasons: [] };
    if (!this.env.OPENAI_API_KEY)
      throw new ModerationProviderError("モデレーションAPI keyがありません", "MODERATION_CONFIGURATION_INVALID");
    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
          "cf-aig-collect-log-payload": "false",
          "cf-aig-skip-cache": "true",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.env.MODERATION_MODEL || "omni-moderation-latest",
          input: inputs.map((item) => item.text),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ModerationProviderError("入力内容の事前チェックに接続できません", "MODERATION_PROVIDER_UNAVAILABLE");
    }
    const payload: OpenAiModerationPayload = await response.json<OpenAiModerationPayload>().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.results) || payload.results.length !== inputs.length)
      throw new ModerationProviderError("入力内容の事前チェックを完了できません", "MODERATION_PROVIDER_UNAVAILABLE");

    const reasons: ModerationReason[] = [];
    payload.results.forEach((result, index) => {
      if (!result.flagged) return;
      for (const [category, flagged] of Object.entries(result.categories ?? {})) {
        const label = REJECTED_CATEGORY_LABELS[category];
        if (flagged && label) reasons.push({ field: inputs[index].field, category, label });
      }
    });
    return reasons.length ? { allowed: false, reasons } : { allowed: true, reasons: [] };
  }
}

class AllowAllModerationProvider implements ModerationProvider {
  readonly providerId = "fake";
  async moderate(): Promise<ModerationResult> {
    return { allowed: true, reasons: [] };
  }
}

export function createModerationProvider(env: Env): ModerationProvider {
  return env.MODERATION_PROVIDER === "fake" ? new AllowAllModerationProvider() : new OpenAiModerationProvider(env);
}
