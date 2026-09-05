import * as dispatcher from "../platform/outbox/dispatch";
import type { Env } from "../types";
import { deliver } from "./delivery";
export function dispatchOutboxEvent(env: Env, eventId: string) {
  return dispatcher.dispatchOutboxEvent(env, eventId, deliver);
}
export function dispatchPendingOutbox(env: Env, limit = 50) {
  return dispatcher.dispatchPendingOutbox(env, limit, deliver);
}
export function dispatchPendingProfileRebuild(env: Env, ownerUserId: string) {
  return dispatcher.dispatchPendingProfileRebuild(env, ownerUserId, deliver);
}
