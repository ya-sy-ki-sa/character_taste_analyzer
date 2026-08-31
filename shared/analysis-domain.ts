export const analysisDomainValues = ["standard", "dark"] as const;

export type AnalysisDomain = (typeof analysisDomainValues)[number];

export function apiPrefixForDomain(domain: AnalysisDomain): string {
  return domain === "dark" ? "/api/v1/dark" : "/api/v1";
}

export function appPrefixForDomain(domain: AnalysisDomain): string {
  return domain === "dark" ? "/dark-lab/app" : "/app";
}
