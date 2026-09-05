import type { AnalysisDomain } from "../../shared/analysis-domain";
import { nowIso, sha256Hex } from "../lib/crypto";
import { insertModelRunMetadata } from "./repositories/model-runs";
import type { LlmRunMetadata } from "./types";

export async function prepareModelRun(
  db: D1Database,
  input: {
    ownerUserId: string;
    operation: string;
    promptVersion: string;
    schemaVersion: string;
    inputHash: string;
    output: unknown;
    metadata: LlmRunMetadata;
    analysisDomain: AnalysisDomain;
  },
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const id = crypto.randomUUID();
  const outputHash = await sha256Hex(JSON.stringify(input.output));
  return {
    id,
    statement: insertModelRunMetadata(db, { ...input, id, outputHash, createdAt: nowIso() }),
  };
}
