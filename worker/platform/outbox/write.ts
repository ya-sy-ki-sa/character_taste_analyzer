import { nowIso, sha256Hex } from "../../lib/crypto";
import type {
  CharacterAnalysisWorkflowParams,
  Env,
  ExportWorkflowParams,
  GenerationWorkflowParams,
  ProfileRebuildWorkflowParams,
} from "../../types";
import * as repository from "./repositories/write";

export type OutboxPayload =
  | { type: "analysis.start"; params: CharacterAnalysisWorkflowParams }
  | { type: "generation.start"; params: GenerationWorkflowParams }
  | { type: "profile.rebuild"; params: ProfileRebuildWorkflowParams }
  | { type: "export.start"; params: ExportWorkflowParams };

export async function outboxStatement(
  env: Env,
  ownerUserId: string,
  aggregateType: string,
  aggregateId: string,
  aggregateRevision: number,
  payload: OutboxPayload,
  deduplicationKey: string,
  correlationId: string,
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const now = nowIso();
  return {
    id,
    statement: repository.insertOutboxEvents(env.DB, [
      id,
      ownerUserId,
      aggregateType,
      aggregateId,
      aggregateRevision,
      payload.type,
      payloadJson,
      await sha256Hex(payloadJson),
      correlationId,
      deduplicationKey,
      now,
      now,
    ]),
  };
}
