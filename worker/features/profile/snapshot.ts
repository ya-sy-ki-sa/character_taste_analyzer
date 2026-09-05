import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { snapshotItemLabel } from "../../../shared/presentation-labels";
import { all, first } from "../../lib/db";
import type { Env } from "../../types";
import { loadProjectionFreshness } from "./projection";
import * as repository from "./repositories/snapshot";

export async function loadProfileSnapshotItems(env: Env, ownerUserId: string, analysisDomain: AnalysisDomain) {
  const freshness = await loadProjectionFreshness(env, ownerUserId);
  if (freshness.status !== "fresh") return { snapshot: null, items: [] };
  const snapshot = await first<{ id: string; profile_generation: number }>(
    repository.selectProfileSnapshots(env.DB, [ownerUserId]),
  );
  if (!snapshot) return { snapshot: null, items: [] };
  const items = await all<{
    id: string;
    item_type: string;
    stable_key: string;
    label: string;
    payload_json: string;
  }>(repository.selectProfileSnapshotItems(env.DB, [snapshot.id, analysisDomain]));
  const attributeRows = await all<{ stable_key: string; label: string }>(
    repository.selectAttributeDefinitions(env.DB, [analysisDomain]),
  );
  const attributeLabels = new Map(attributeRows.map((row) => [row.stable_key, row.label]));
  return {
    snapshot: { id: snapshot.id, generation: snapshot.profile_generation },
    items: items.map((item) => {
      const view = {
        id: item.id,
        type: item.item_type,
        stableKey: item.stable_key,
        label: item.label,
        payload: JSON.parse(item.payload_json) as Record<string, unknown>,
      };
      return { ...view, label: snapshotItemLabel(view, attributeLabels) };
    }),
  };
}
