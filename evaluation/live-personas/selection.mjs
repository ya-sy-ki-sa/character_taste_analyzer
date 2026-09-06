import { digest } from "./storage.mjs";

export function selectDataset(dataset, caseIds) {
  if (!caseIds?.length || caseIds.some((id) => !id) || new Set(caseIds).size !== caseIds.length)
    throw new Error("INVALID_CASE_SELECTION");
  const cases = dataset.cases.filter((c) => caseIds.includes(c.id));
  if (cases.length !== caseIds.length || digest(cases.map((c) => c.id)) !== digest(caseIds))
    throw new Error("CASE_SELECTION_MUST_MATCH_DATASET_ORDER");
  return { ...dataset, cases };
}
export function validateSelection(dataset, manifest, selection) {
  if (digest(dataset) !== manifest.sha256 || dataset.cases.length !== manifest.cases)
    throw new Error("Frozen dataset mismatch");
  if (
    selection &&
    (selection.datasetHash !== digest(dataset) || digest(selection.caseIds) !== digest(dataset.cases.map((c) => c.id)))
  )
    throw new Error("Frozen selection mismatch");
}
