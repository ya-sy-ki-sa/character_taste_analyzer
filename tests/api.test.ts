import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setCsrfToken, setSessionExpiredHandler } from "../src/api";

function errorResponse(code: string) {
  return new Response(
    JSON.stringify({
      error: { code, message: "認証エラー", requestId: "request-test" },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  setCsrfToken(undefined);
  setSessionExpiredHandler(undefined);
  vi.unstubAllGlobals();
});

describe("API session handling", () => {
  it("clears the client session when an authenticated endpoint reports session_required", async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("session_required")));

    await expect(api("/api/v1/profile")).rejects.toMatchObject({ status: 401, code: "session_required" });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does not clear the client session for another kind of 401", async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("http_401")));

    await expect(api("/api/v1/account/key-rotation")).rejects.toMatchObject({ status: 401, code: "http_401" });
    expect(expired).not.toHaveBeenCalled();
  });

  it("normalizes a non-JSON upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));

    await expect(api("/api/v1/profile")).rejects.toMatchObject({
      status: 502,
      code: "invalid_response",
      message: "サーバーから予期しない応答が返されました",
    });
  });

  it("preserves an explicit null data payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(api<null>("/api/v1/example")).resolves.toBeNull();
  });
});
