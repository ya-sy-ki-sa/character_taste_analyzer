import type { z } from "zod";
import { type AnalysisDomain, apiPrefixForDomain } from "../../../shared/analysis-domain";
import type { darkScopeReviewRequestSchema } from "../../../shared/contracts/dark-understanding";
import type { AnyEntrySubmission, identityCandidateRequestSchema } from "../../../shared/contracts/entries";
import type {
  EntryCreation,
  EntryList,
  EntryReanalysisResult,
  IdentityCandidates,
  PreferenceActivation,
  PreferenceMutationResult,
  RefinementResult,
  ScopeReviewResult,
  UnderstandingConfirmation,
  UnderstandingMutationResult,
} from "../../../shared/contracts/entries-response";
import type { ReviewDetail } from "../../../shared/contracts/entry-review";
import type { preferenceRefinementSchema } from "../../../shared/contracts/refinement";
import type {
  preferenceReviewRequestSchema,
  understandingReviewRequestSchema,
} from "../../../shared/contracts/reviews";
import { request, send } from "../../lib/http";

export const entriesApi = {
  list: (domain: AnalysisDomain) => request<EntryList>(`${apiPrefixForDomain(domain)}/entries`),
  review: (domain: AnalysisDomain, id: string) => request<ReviewDetail>(`${apiPrefixForDomain(domain)}/entries/${id}`),
  identityCandidates: (domain: AnalysisDomain, input: z.input<typeof identityCandidateRequestSchema>) =>
    send<IdentityCandidates>(`${apiPrefixForDomain(domain)}/identity-candidates`, "POST", input),
  create: (domain: AnalysisDomain, input: AnyEntrySubmission, key: string) =>
    send<EntryCreation>(`${apiPrefixForDomain(domain)}/entries`, "POST", input, key),
  reanalyze: (domain: AnalysisDomain, id: string, draft: AnyEntrySubmission, key: string) =>
    send<EntryReanalysisResult>(`${apiPrefixForDomain(domain)}/entries/${id}/reanalysis`, "POST", { draft }, key),
  archive: (domain: AnalysisDomain, id: string) =>
    request<void>(`${apiPrefixForDomain(domain)}/entries/${id}`, { method: "DELETE" }),
  reviewUnderstanding: (
    domain: AnalysisDomain,
    id: string,
    input: z.input<typeof understandingReviewRequestSchema>,
    key?: string,
  ) =>
    send<UnderstandingMutationResult | UnderstandingConfirmation>(
      `${apiPrefixForDomain(domain)}/understanding-snapshots/${id}/review`,
      "POST",
      input,
      key,
    ),
  reviewPreference: (
    domain: AnalysisDomain,
    id: string,
    input: z.input<typeof preferenceReviewRequestSchema>,
    key?: string,
  ) =>
    send<PreferenceMutationResult | PreferenceActivation>(
      `${apiPrefixForDomain(domain)}/preference-analysis-runs/${id}/review`,
      "POST",
      input,
      key,
    ),
  reviewScope: (domain: AnalysisDomain, id: string, input: z.input<typeof darkScopeReviewRequestSchema>) =>
    send<ScopeReviewResult>(`${apiPrefixForDomain(domain)}/scope-assessments/${id}/review`, "POST", input),
  refine: (domain: AnalysisDomain, id: string, input: z.input<typeof preferenceRefinementSchema>, key: string) =>
    send<RefinementResult>(`${apiPrefixForDomain(domain)}/entries/${id}/preference-input`, "POST", input, key),
};
