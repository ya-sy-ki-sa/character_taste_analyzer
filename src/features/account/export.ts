import { ApiClientError, downloadFile } from "../../lib/http";
import { accountApi } from "./api";

export async function downloadExport(): Promise<void> {
  let status = "queued";
  const { exportId } = await accountApi.createExport();
  for (let attempt = 0; attempt < 60 && !["ready", "failed", "expired"].includes(status); attempt += 1) {
    if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    const current = await accountApi.exportStatus(exportId);
    status = current.export.status;
    if (status === "failed")
      throw new ApiClientError("エクスポートの作成に失敗しました", 500, current.export.error_code ?? "EXPORT_FAILED");
  }
  if (status !== "ready") throw new ApiClientError("エクスポートの準備が完了しませんでした", 409, "EXPORT_NOT_READY");
  await downloadFile(
    `/api/v1/account/exports/${exportId}/download`,
    `character-taste-export-${new Date().toISOString().slice(0, 10)}.json`,
  );
}
