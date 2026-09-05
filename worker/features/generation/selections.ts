import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { all, placeholders } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/selections";

export const D1_ID_VALIDATION_CHUNK_SIZE = 90;

export async function validateSnapshotItemIds(
  env: Env,
  snapshotId: string,
  ids: string[],
  analysisDomain?: AnalysisDomain,
): Promise<boolean> {
  const found = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += D1_ID_VALIDATION_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + D1_ID_VALIDATION_CHUNK_SIZE);
    if (!chunk.length) continue;
    const rows = await all<{ id: string }>(
      repository.selectProfileSnapshotItems(
        env.DB,
        analysisDomain ? " AND analysis_domain=?" : "",
        placeholders(chunk.length),
        [snapshotId, ...(analysisDomain ? [analysisDomain] : []), ...chunk],
      ),
    );
    for (const row of rows) found.add(row.id);
  }
  return found.size === ids.length;
}
