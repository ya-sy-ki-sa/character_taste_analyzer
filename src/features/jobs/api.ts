import { type AnalysisDomain, apiPrefixForDomain } from "../../../shared/analysis-domain";
import type { JobRetryResult } from "../../../shared/contracts/jobs-response";
import { request } from "../../lib/http";
export const jobsApi = {
  retry: (domain: AnalysisDomain, id: string) =>
    request<JobRetryResult>(`${apiPrefixForDomain(domain)}/jobs/${id}/retry`, { method: "POST" }),
};
