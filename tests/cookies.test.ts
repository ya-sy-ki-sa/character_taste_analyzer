import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  LOCAL_SESSION_COOKIE,
  readSessionCookie,
  SESSION_COOKIE,
  sessionCookie,
} from "../worker/lib/cookies";

describe("session cookies", () => {
  it("keeps the __Host- cookie protections outside local development", () => {
    const cookie = sessionCookie("token value", 60, "production");

    expect(cookie).toBe(`${SESSION_COOKIE}=token%20value; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Strict`);
    expect(readSessionCookie(`${SESSION_COOKIE}=token%20value`, "production")).toBe("token value");
    expect(clearSessionCookie("preview")).toBe(
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
    );
  });

  it("uses an HTTP-compatible cookie only in the local environment", () => {
    const cookie = sessionCookie("local-token", 60, "local");

    expect(cookie).toBe(`${LOCAL_SESSION_COOKIE}=local-token; Max-Age=60; Path=/; HttpOnly; SameSite=Strict`);
    expect(cookie).not.toContain("; Secure");
    expect(readSessionCookie(`${LOCAL_SESSION_COOKIE}=local-token`, "local")).toBe("local-token");
    expect(readSessionCookie(`${SESSION_COOKIE}=local-token`, "local")).toBeUndefined();
    expect(clearSessionCookie("local")).toBe(`${LOCAL_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
  });
});
