import { describe, expect, it, vi } from "vitest";
import type { EntryDraft, GenerationRequestInput } from "../shared/schemas";
import {
  moderateEntryDraft,
  moderateGenerationInput,
  moderationRejectionMessage,
} from "../worker/services/input-moderation";
import type { ModerationProvider } from "../worker/moderation/types";
import type { Env } from "../worker/types";

function recordingProvider(moderate = vi.fn().mockResolvedValue({ allowed: true, reasons: [] })) {
  return { providerId: "recording", moderate } satisfies ModerationProvider;
}

describe("LLM input pre-moderation", () => {
  it("sends user-authored entry text with screen labels and omits control values", async () => {
    const provider = recordingProvider();
    const draft: EntryDraft = {
      registrationType: "original",
      characterName: "テスト人物",
      characterBasicInfo: "人物の説明",
      referenceMaterial: "補足資料",
      preferenceContext: undefined,
      userCharacterView: undefined,
      preference: {
        likedReasons: "好きな点",
        dislikedReasons: undefined,
        responseChannels: [],
        valueStanceNote: undefined,
      },
    };

    await moderateEntryDraft({} as Env, draft, provider);

    expect(provider.moderate).toHaveBeenCalledWith([
      { field: "キャラクター名", text: "テスト人物" },
      { field: "キャラクター基本情報", text: "人物の説明" },
      { field: "追加の参考情報", text: "補足資料" },
      { field: "好きな理由", text: "好きな点" },
    ]);
  });

  it("moderates every free-text generation condition before generation", async () => {
    const provider = recordingProvider();
    const input = {
      mode: "balanced",
      purpose: "目的",
      world: "世界",
      genre: "ジャンル",
      role: "役割",
      tone: "トーン",
      freeInstruction: "指示",
      selectedItemIds: ["00000000-0000-4000-8000-000000000001"],
      prohibitedItemIds: [],
    } satisfies GenerationRequestInput;

    await moderateGenerationInput({} as Env, input, provider);
    expect(provider.moderate).toHaveBeenCalledWith([
      { field: "作成目的", text: "目的" },
      { field: "世界観", text: "世界" },
      { field: "ジャンル", text: "ジャンル" },
      { field: "物語上の役割", text: "役割" },
      { field: "表現トーン", text: "トーン" },
      { field: "自由指示", text: "指示" },
    ]);
  });

  it("formats rejected fields and causes for display", () => {
    expect(
      moderationRejectionMessage({
        allowed: false,
        reasons: [
          { field: "自由指示", category: "violence", label: "暴力的な内容" },
          { field: "自由指示", category: "violence", label: "暴力的な内容" },
        ],
      }),
    ).toContain("自由指示：暴力的な内容");
  });
});
