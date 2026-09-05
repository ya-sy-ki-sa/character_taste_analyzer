import { all, placeholders } from "../../lib/db";
import type { Env } from "../../types";
import * as repository from "./repositories/evidence";
import type { EvidenceView } from "./types";

export async function loadEvidenceViews(
  env: Env,
  ownerUserId: string,
  ownerType: "character_assertion" | "preference_assertion" | "value_stance_assertion",
  ownerIds: string[],
): Promise<Map<string, EvidenceView[]>> {
  const grouped = new Map<string, EvidenceView[]>();
  for (let offset = 0; offset < ownerIds.length; offset += 90) {
    const chunk = ownerIds.slice(offset, offset + 90);
    if (!chunk.length) continue;
    const rows = await all<{
      id: string;
      owner_id: string;
      verification_status: string;
      inference_type: string;
      excerpt_text: string | null;
      user_input_path: string | null;
      title: string | null;
      citation_json: string | null;
    }>(repository.selectEvidenceFragments(env.DB, placeholders(chunk.length), [ownerUserId, ownerType, ...chunk]));
    for (const row of rows) {
      const citation = row.citation_json ? (JSON.parse(row.citation_json) as Record<string, unknown>) : {};
      const sourceUrl = typeof citation.url === "string" ? citation.url : null;
      const items = grouped.get(row.owner_id) ?? [];
      items.push({
        id: row.id,
        verificationStatus: row.verification_status,
        inferenceType: row.inference_type,
        quote: row.excerpt_text,
        inputPointer: row.user_input_path,
        sourceTitle: row.title,
        sourceUrl,
        sourceProvider: typeof citation.provider === "string" ? citation.provider : null,
        trustReason: typeof citation.trustReason === "string" ? citation.trustReason : null,
        canNavigate: row.verification_status === "verified_quote" && sourceUrl !== null,
      });
      grouped.set(row.owner_id, items);
    }
  }
  return grouped;
}
