import type { GenerationSelection, Treatment } from "../../../shared/contracts/generation-brief";
import { darkResponseChannelCatalog } from "../../../shared/dark-response-channels";
import { responseChannelCatalog, responseChannelLabel } from "../../../shared/response-channels";

export type SnapshotSelection = {
  id: string;
  item_type: string;
  stable_key: string;
  label: string;
  payload_json: string;
  treatment: Treatment;
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function compileGenerationSelections(items: SnapshotSelection[], generation: number): GenerationSelection[] {
  return items.map((item) => {
    const payload = record(JSON.parse(item.payload_json));
    const responseChannel = typeof payload.responseChannel === "string" ? payload.responseChannel : null;
    const valueStance =
      item.item_type === "value_stance" && typeof payload.targetRef === "string" && typeof payload.stance === "string"
        ? {
            target: payload.targetRef,
            targetType: String(payload.targetType ?? "unspecified"),
            orientation: String(payload.orientation ?? "mixed"),
            stance: payload.stance,
            scope: record(payload.scope),
          }
        : null;
    return {
      profileSnapshotItemId: item.id,
      stableKey: item.stable_key,
      label: item.label,
      treatment: item.treatment,
      weight:
        item.treatment === "required" || item.treatment === "prohibit" ? 1 : item.treatment === "include" ? 0.8 : 0.55,
      condition: valueStance?.scope ?? record(payload.condition),
      responseChannel,
      reactionDescription: responseChannel
        ? [
            responseChannelLabel(responseChannel),
            [...responseChannelCatalog, ...darkResponseChannelCatalog].find((item) => item.value === responseChannel)
              ?.description,
          ]
            .filter(Boolean)
            .join("：")
        : null,
      polarity:
        typeof payload.positiveScore === "number" && typeof payload.negativeScore === "number"
          ? { positive: payload.positiveScore, negative: payload.negativeScore }
          : null,
      valueStance,
      rationale: `嗜好スナップショット世代${generation}でユーザーが選択`,
      overrideText: null,
    };
  });
}
export function selectionValuePolicy(items: GenerationSelection[]) {
  return {
    allowedOrientations: [
      ...new Set(
        items
          .filter((item) => item.treatment !== "prohibit")
          .flatMap((item) => (item.valueStance ? [item.valueStance.orientation] : [])),
      ),
    ],
    requiredStances: items
      .filter((item) => item.treatment === "required")
      .flatMap((item) =>
        item.valueStance
          ? [{ target: item.valueStance.target, stance: item.valueStance.stance, scope: item.valueStance.scope }]
          : [],
      ),
    redemption: "not_required" as const,
    hiddenGoodness: "not_required" as const,
    moralJustification: "not_required" as const,
    punishmentOrDefeat: "not_required" as const,
  };
}
