import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, downloadFile, request, send, setCsrfToken, setSessionExpiredHandler } from "../src/lib/http";

afterEach(() => {
  setCsrfToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HTTP success and error contracts", () => {
  it("accepts only the data envelope, including null", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { id: "item" } }))
      .mockResolvedValueOnce(Response.json({ data: null }))
      .mockResolvedValueOnce(Response.json({ id: "item" }));
    vi.stubGlobal("fetch", fetch);
    expect(await request("/item")).toEqual({ id: "item" });
    expect(await request("/item")).toBeNull();
    await expect(request("/item")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each(["", "invalid json"])("rejects an invalid successful body: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(request("/item")).rejects.toBeInstanceOf(ApiClientError);
  });
  it("keeps 204 deletion responses separate from JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await request("/item", { method: "DELETE" })).toBeUndefined();
  });
  it("sends session, CSRF and stable idempotency headers on mutations", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    vi.stubGlobal("fetch", fetch);
    setCsrfToken("csrf-fixture");
    await send("/item", "POST", { title: "入力" }, "same-request");
    const options = fetch.mock.calls[0][1];
    expect(options.credentials).toBe("include");
    expect(options.headers.get("X-CSRF-Token")).toBe("csrf-fixture");
    expect(options.headers.get("Idempotency-Key")).toBe("same-request");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ title: "入力" });
  });
  it("expires only the current session handler and preserves API errors", async () => {
    const previous = vi.fn(),
      current = vi.fn();
    const disposePrevious = setSessionExpiredHandler(previous),
      disposeCurrent = setSessionExpiredHandler(current);
    disposePrevious();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "SESSION_REQUIRED", message: "再認証してください", requestId: "trace" } },
            { status: 401 },
          ),
        ),
    );
    await expect(request("/item")).rejects.toMatchObject({ status: 401, code: "SESSION_REQUIRED", requestId: "trace" });
    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    disposeCurrent();
  });
  it("keeps non-session errors from triggering logout", async () => {
    const expired = vi.fn(),
      dispose = setSessionExpiredHandler(expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid", { status: 503 })));
    await expect(request("/item")).rejects.toMatchObject({ status: 503, code: "invalid_response" });
    expect(expired).not.toHaveBeenCalled();
    dispose();
  });
  it("downloads raw files without JSON envelope parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("export bytes")));
    const create = vi.fn().mockReturnValue("blob:fixture"),
      revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await downloadFile("/export", "export.json");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:fixture");
  });
  it.each([true, false])("reports download errors (structured: %s)", async (structured) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          structured
            ? Response.json({ error: { code: "SESSION_REQUIRED", message: "セッション失効" } }, { status: 401 })
            : new Response("", { status: 500 }),
        ),
    );
    await expect(downloadFile("/export", "export.json")).rejects.toMatchObject({
      code: structured ? "SESSION_REQUIRED" : "export_failed",
    });
  });
});
