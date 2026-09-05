import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { GenerationRequestInput } from "../../../shared/contracts/generation";
import type { GenerationBrief, Treatment } from "../../../shared/contracts/generation-brief";
import { nowIso, sha256Hex } from "../../lib/crypto";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/brief";
import { compileGenerationSelections, selectionValuePolicy } from "./treatments";
import type { Snapshot, SnapshotItem } from "./types";

export async function compileBrief(
  env: Env,
  ownerUserId: string,
  requestId: string,
): Promise<{ brief: GenerationBrief; briefRowId: string }> {
  const request = await first<{
    profile_snapshot_id: string;
    mode: GenerationRequestInput["mode"];
    user_constraints_json: string;
    brief_revision: number;
    analysis_domain: AnalysisDomain;
  }>(repository.selectGenerationRequests(env.DB, [requestId, ownerUserId]));
  if (!request) throw new Error("GENERATION_REQUEST_NOT_FOUND");
  const snapshot = await first<Snapshot>(
    repository.selectProfileSnapshots(env.DB, [request.profile_snapshot_id, ownerUserId]),
  );
  if (!snapshot) throw new Error("PROFILE_SNAPSHOT_NOT_FOUND");
  const selections = await all<SnapshotItem & { treatment: Treatment }>(
    repository.selectGenerationRequestPreferences(env.DB, [requestId, request.analysis_domain]),
  );
  if (!selections.length) throw new Error("GENERATION_SELECTION_EMPTY");
  const input = JSON.parse(request.user_constraints_json) as GenerationRequestInput;
  const briefRowId = crypto.randomUUID();
  const compiledSelections = compileGenerationSelections(selections, snapshot.profile_generation);
  const brief: GenerationBrief = {
    schemaVersion: "2.0",
    analysisDomain: request.analysis_domain,
    briefId: briefRowId,
    generationRequestId: requestId,
    profileSnapshot: {
      id: snapshot.id,
      generation: snapshot.profile_generation,
      contentHash: snapshot.content_hash,
      ontologyVersion: snapshot.ontology_version,
      algorithmVersion: snapshot.algorithm_version,
    },
    mode: request.mode,
    purpose: input.purpose,
    creativeContext: {
      world: input.world ?? null,
      genre: input.genre ?? null,
      role: input.role ?? null,
      tone: input.tone ?? null,
      targetDetail: "detailed",
    },
    preferenceSelections: compiledSelections,
    valuePolicy: selectionValuePolicy(compiledSelections),
    constraints: {
      required: selections.filter((item) => item.treatment === "required").map((item) => item.id),
      prohibited: selections.filter((item) => item.treatment === "prohibit").map((item) => item.id),
      contentBoundaries: [],
      freeInstruction: input.freeInstruction ?? null,
    },
    nonRequirements: [
      "道徳的に善くする必要はない",
      "hidden goodnessや悲劇的正当化を追加する必要はない",
      "改心、贖罪、敗北、処罰を追加する必要はない",
      "ヒーローや中心人物にする必要はない",
      "全嗜好属性を一人へ詰め込む必要はない",
      "フィクション嗜好を現実の人格へ関連づける必要はない",
    ],
    similarityPolicy: {
      avoidNamedCharacters: [],
      nameThreshold: 0.92,
      semanticThreshold: 0.9,
      combinationThreshold: 0.86,
    },
    provenance: {
      selectedItemIds: selections.map((item) => item.id),
      userConstraintHash: await sha256Hex(request.user_constraints_json),
      compiledAt: nowIso(),
    },
  };
  const briefJson = JSON.stringify(brief);
  const now = nowIso();
  const results = await env.DB.batch([
    repository.insertGenerationBriefs(env.DB, [
      briefRowId,
      requestId,
      request.brief_revision + 1,
      briefJson,
      await sha256Hex(briefJson),
      now,
    ]),
    repository.updateGenerationRequests(env.DB, [now, requestId, ownerUserId]),
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1_BRIEF_COMPILE_FAILED");
  return { brief, briefRowId };
}
