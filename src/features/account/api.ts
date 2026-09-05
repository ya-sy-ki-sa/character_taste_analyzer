import type { z } from "zod";
import type {
  accountDeletionSchema,
  activationSchema,
  loginSchema,
  registrationSchema,
} from "../../../shared/contracts/account";
import type { ExportCreation, ExportStatus, RegistrationResult } from "../../../shared/contracts/account-response";
import type { MeResponse } from "../../../shared/contracts/session-response";
import { request, send } from "../../lib/http";

export const accountApi = {
  me: () => request<MeResponse>("/api/v1/me"),
  login: (input: z.input<typeof loginSchema>) => send<MeResponse>("/api/v1/sessions", "POST", input),
  register: (input: z.input<typeof registrationSchema>, key: string) =>
    send<RegistrationResult>("/api/v1/users", "POST", input, key),
  activate: (id: string, input: z.input<typeof activationSchema>) =>
    send<{ user: RegistrationResult["user"] }>(`/api/v1/users/${id}/activate`, "POST", input),
  logout: () => request<void>("/api/v1/sessions", { method: "DELETE" }),
  delete: (input: z.input<typeof accountDeletionSchema>) => send<void>("/api/v1/account", "DELETE", input),
  createExport: () => send<ExportCreation>("/api/v1/account/exports", "POST", {}),
  exportStatus: (id: string) => request<ExportStatus>(`/api/v1/account/exports/${id}`),
};
