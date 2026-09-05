import type { PreferenceReviewMutation, UnderstandingReviewMutation } from "../../../shared/contracts/reviews";

export type ReviewMutationHandler = (input: UnderstandingReviewMutation) => Promise<boolean>;

export type PreferenceMutationHandler = (input: PreferenceReviewMutation) => Promise<boolean>;
