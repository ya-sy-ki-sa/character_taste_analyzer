import type { ApiError } from "../shared/schemas";

let csrfToken: string | undefined;
let sessionExpiredHandler: (() => void) | undefined;

type ApiPayload<T> = { data?: T; error?: ApiError } & Record<string, unknown>;

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function setCsrfToken(value?: string) {
  csrfToken = value;
}

export function setSessionExpiredHandler(handler?: () => void) {
  sessionExpiredHandler = handler;
  return () => {
    if (sessionExpiredHandler === handler) sessionExpiredHandler = undefined;
  };
}

function handleSessionError(status: number, code?: string) {
  if (status !== 401 || code !== "SESSION_REQUIRED") return;
  csrfToken = undefined;
  sessionExpiredHandler?.();
}

async function readPayload<T>(response: Response): Promise<ApiPayload<T> | undefined> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ApiPayload<T>;
  } catch {
    return undefined;
  }
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("Idempotency-Key", init.idempotencyKey ?? crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const payload = await readPayload<T>(response);
  if (!response.ok) {
    const error = payload?.error;
    handleSessionError(response.status, error?.code);
    throw new ApiClientError(
      error?.message ?? "サーバーから予期しない応答が返されました",
      response.status,
      error?.code ?? "invalid_response",
      error?.requestId,
    );
  }
  if (!payload) {
    throw new ApiClientError("サーバーから予期しない応答が返されました", response.status, "invalid_response");
  }
  return (Object.hasOwn(payload, "data") ? payload.data : payload) as T;
}

export async function downloadExport(): Promise<void> {
  const created = await api<{ exportId: string }>("/api/v1/account/exports", {
    method: "POST",
    body: "{}",
  });
  let status = "queued";
  for (let attempt = 0; attempt < 60 && !["ready", "failed", "expired"].includes(status); attempt += 1) {
    if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    const current = await api<{ export: { status: string; error_code?: string } }>(
      `/api/v1/account/exports/${created.exportId}`,
    );
    status = current.export.status;
    if (status === "failed")
      throw new ApiClientError("エクスポートの作成に失敗しました", 500, current.export.error_code ?? "EXPORT_FAILED");
  }
  if (status !== "ready") throw new ApiClientError("エクスポートの準備が完了しませんでした", 409, "EXPORT_NOT_READY");
  const response = await fetch(`/api/v1/account/exports/${created.exportId}/download`, { credentials: "include" });
  if (!response.ok) {
    const payload = await readPayload<never>(response);
    handleSessionError(response.status, payload?.error?.code);
    throw new ApiClientError(
      payload?.error?.message ?? "エクスポートに失敗しました",
      response.status,
      payload?.error?.code ?? "export_failed",
      payload?.error?.requestId,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `character-taste-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
