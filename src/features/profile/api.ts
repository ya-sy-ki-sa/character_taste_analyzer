import { type AnalysisDomain, apiPrefixForDomain } from "../../../shared/analysis-domain";
import type { SnapshotResponse } from "../../../shared/contracts/generation-response";
import type { GraphResponse, ProfileResponse } from "../../../shared/contracts/profile-response";
import { request } from "../../lib/http";
export const profileApi = {
  current: (domain: AnalysisDomain) => request<ProfileResponse>(`${apiPrefixForDomain(domain)}/profile`),
  graph: (domain: AnalysisDomain) =>
    request<GraphResponse>(`${apiPrefixForDomain(domain)}/profile/graph?detail=standard`),
  snapshotItems: (domain: AnalysisDomain) =>
    request<SnapshotResponse>(`${apiPrefixForDomain(domain)}/profile/snapshot-items`),
};
