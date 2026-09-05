import type { ApiError } from "../../shared/contracts/http";

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

export async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
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
  if (!payload || !Object.hasOwn(payload, "data")) {
    throw new ApiClientError("サーバーから予期しない応答が返されました", response.status, "invalid_response");
  }
  return payload.data as T;
}

export function send<Output>(path: string, method: "POST" | "DELETE", input: unknown, key?: string): Promise<Output> {
  return request<Output>(path, { method, body: JSON.stringify(input), idempotencyKey: key });
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(path, { credentials: "include" });
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
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
