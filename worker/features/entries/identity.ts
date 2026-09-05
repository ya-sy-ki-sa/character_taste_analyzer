import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { IdentityCandidate, IdentityCandidateRequest } from "../../../shared/contracts/entries";
import { normalizeIdentityPart } from "../../lib/crypto";
import { all } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/identity";

export async function listIdentityCandidates(
  env: Env,
  ownerUserId: string,
  analysisDomain: AnalysisDomain,
  input: IdentityCandidateRequest,
): Promise<IdentityCandidate[]> {
  return all<IdentityCandidate>(
    repository.selectCharacterIdentities(env.DB, [
      normalizeIdentityPart(input.characterName),
      normalizeIdentityPart(input.workTitle),
      ownerUserId,
      analysisDomain,
      analysisDomain,
      normalizeIdentityPart(input.characterName),
      normalizeIdentityPart(input.workTitle),
    ]),
  );
}
