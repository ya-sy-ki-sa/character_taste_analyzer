import { summarizeUnderstandingEvidence } from "../../../shared/understanding-evidence";

/** Export uses the same current-assertion policy as review, including historical snapshots. */
export function exportUnderstandingEvidence(
  snapshots: Record<string, unknown>[],
  assertions: Record<string, unknown>[],
  evidence: Record<string, unknown>[],
) {
  const byAssertion = new Map<string, { id: string; verificationStatus: string; evidenceOrigin: string }[]>();
  for (const row of evidence) {
    if (row.owner_type !== "character_assertion") continue;
    const key = String(row.owner_id);
    const items = byAssertion.get(key) ?? [];
    items.push({
      id: String(row.id),
      verificationStatus: String(row.verification_status),
      evidenceOrigin: String(row.evidence_origin),
    });
    byAssertion.set(key, items);
  }
  const bySnapshot = new Map<string, Parameters<typeof summarizeUnderstandingEvidence>[0][number][]>();
  for (const row of assertions) {
    const key = String(row.snapshot_id);
    const items = bySnapshot.get(key) ?? [];
    items.push({ status: String(row.status), evidence: byAssertion.get(String(row.id)) ?? [] });
    bySnapshot.set(key, items);
  }
  return snapshots.map((row) => ({
    snapshotId: String(row.id),
    evidenceSummary: summarizeUnderstandingEvidence(bySnapshot.get(String(row.id)) ?? []),
  }));
}
