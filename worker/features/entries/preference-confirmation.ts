import type { PreferenceReviewMutation } from "../../../shared/contracts/reviews";
import { preferenceContextLabel } from "../../../shared/preference-context";
import { responseChannelLabel } from "../../../shared/response-channels";
import { valueOrientationLabel, valueStanceLabel } from "../../../shared/value-stance-labels";

export type ContentPreferenceReview = Exclude<PreferenceReviewMutation, { action: "set_response_channel" }>;
export const PREFERENCE_CONFIRMATION_POLICY = "preference-confirmation/v1.0.0";

/** A literal record of the submitted fields, not an interpretation of the user's intent. */
export function preferenceConfirmationText(
  input: ContentPreferenceReview,
  contextJson: string,
  attributeLabel: string | null,
): string {
  const fields =
    input.action === "add_preference" || input.action === "update_preference"
      ? [
          `好みの対象（元表現）：${input.rawLabel}`,
          `対応する属性：${attributeLabel ?? "未対応"}`,
          `支持：${{ positive: "好き・肯定的", negative: "苦手・否定的", mixed: "好き嫌いが混在" }[input.polarity]}`,
          `反応経路：${responseChannelLabel(input.responseChannel)}`,
          `強さ：${input.strength}`,
        ]
      : [
          `価値態度の対象：${input.targetRef}`,
          `態度：${valueStanceLabel(input.stance)}`,
          `対象の価値傾向：${valueOrientationLabel(input.orientation)}`,
        ];
  const scope = preferenceContextLabel(contextJson);
  return ["確認画面で保存した本人の申告", ...fields, ...(scope ? [scope] : [])].join("\n");
}
