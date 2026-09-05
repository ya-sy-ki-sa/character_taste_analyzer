import type { z } from "zod";
import { type AnalysisDomain, apiPrefixForDomain } from "../../../shared/analysis-domain";
import type { generationRequestInputSchema } from "../../../shared/contracts/generation";
import type {
  feedbackReviewSchema,
  generationFeedbackSchema,
  generationSelectionSchema,
} from "../../../shared/contracts/generation-feedback";
import type {
  CandidateSelectionResult,
  FeedbackCreation,
  FeedbackResponse,
  FeedbackReviewResult,
  GenerationCreation,
  GenerationList,
} from "../../../shared/contracts/generation-response";
import { request, send } from "../../lib/http";
export const generationApi = {
  list: (domain: AnalysisDomain) => request<GenerationList>(`${apiPrefixForDomain(domain)}/generation-requests`),
  create: (domain: AnalysisDomain, input: z.input<typeof generationRequestInputSchema>, key: string) =>
    send<GenerationCreation>(`${apiPrefixForDomain(domain)}/generation-requests`, "POST", input, key),
  delete: (domain: AnalysisDomain, id: string) =>
    request<void>(`${apiPrefixForDomain(domain)}/generation-requests/${id}`, { method: "DELETE" }),
  select: (domain: AnalysisDomain, id: string, input: z.input<typeof generationSelectionSchema>) =>
    send<CandidateSelectionResult>(`${apiPrefixForDomain(domain)}/generation-requests/${id}/selection`, "POST", input),
  feedback: (domain: AnalysisDomain) => request<FeedbackResponse>(`${apiPrefixForDomain(domain)}/generation-feedback`),
  createFeedback: (domain: AnalysisDomain, input: z.input<typeof generationFeedbackSchema>, key: string) =>
    send<FeedbackCreation>(`${apiPrefixForDomain(domain)}/generation-feedback`, "POST", input, key),
  reviewFeedback: (domain: AnalysisDomain, id: string, input: z.input<typeof feedbackReviewSchema>) =>
    send<FeedbackReviewResult>(`${apiPrefixForDomain(domain)}/generation-feedback/${id}/review`, "POST", input),
};
