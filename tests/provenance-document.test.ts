import { Miniflare } from "miniflare";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentLoader, publicDocumentUrl } from "../worker/platform/provenance/document";
import { prepareExternalProvenanceSources, provenanceForPrompt } from "../worker/platform/provenance/sources";
import { verifyEvidenceReference } from "../worker/platform/provenance/verifier";
import { setup } from "./support/preference-pipeline";

afterEach(() => vi.unstubAllGlobals());

describe("verification-only source documents", () => {
  it("extracts retained document text with the actual Worker HTML parser", async () => {
    const bundle = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: new URL("./support/document-parser-worker.ts", import.meta.url).pathname, formats: ["es"] },
      },
    });
    const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: Array<{ type: string; code?: string }> };
    const code = output.output.find((chunk) => chunk.type === "chunk")?.code;
    if (!code) throw new Error("Worker parser bundle missing");
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: "document-parser-test",
            type: "worker",
            compatibilityDate: "2026-09-01",
            manifest: {
              mainModule: "index.js",
              modules: {
                "index.js": {
                  type: "esm",
                  contents: code,
                },
              },
            },
          },
        },
      ],
    });
    try {
      const response = await mf.dispatchFetch("https://example.com", {
        method: "POST",
        body: "<html><body><script>invented evidence</script><style>hidden</style><template>template evidence</template><noscript>fallback</noscript><p>&ldquo;ビッグ<strong>３</strong>&rdquo;の中心的存在 &amp; &#x4ef2;間<br>改行後</p><p>&lsquo;引用&rsquo; &hellip; &copy; &NotEqualTilde; &amp;ldquo; &lt;script&gt;表示文字&lt;/script&gt; &NbSp; &unknown; &#0; &#x80;</p><p>次の行</p></body></html>",
      });
      const text = await response.text();
      expect(text).toContain("“ビッグ３”の中心的存在 & 仲間");
      expect(text).toContain("‘引用’ … © ≂̸ &ldquo; <script>表示文字</script> &NbSp; &unknown; � €");
      expect(text).toContain("\n改行後");
      expect(text).toContain("\n次の行");
      expect(text).not.toContain("invented evidence");
      expect(text).not.toContain("hidden");
      expect(text).not.toContain("template evidence");
      expect(text).not.toContain("fallback");
      const source = {
        sourceId: "document",
        origin: "source" as const,
        url: "https://example.com",
        inputPointer: null,
        text,
      };
      const ref = {
        sourceRef: null,
        sourceUrl: source.url,
        inputPointer: null,
        quote: "“ビッグ３”の中心的存在",
        inferenceType: "direct" as const,
      };
      const verified = await verifyEvidenceReference(ref, [source], new Set([source.url]));
      expect(verified).toMatchObject({ verificationStatus: "verified_quote" });
      expect(text.slice(verified.quoteStart ?? 0, verified.quoteEnd ?? 0)).toBe(ref.quote);
      expect(
        await verifyEvidenceReference({ ...ref, quote: "“ビッグ３”の中心心的存在" }, [source], new Set([source.url])),
      ).toMatchObject({ issueReason: "quote_not_found" });
    } finally {
      await mf.dispose();
    }
  });
  it.each([
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://foo.local",
    "https://localhost",
    "https://a:b@example.com",
    "https://example.com:8443",
    "file:///etc/passwd",
  ])("rejects %s before fetching", (url) => {
    expect(publicDocumentUrl(url)).toBeNull();
  });
  it("bounds requests, caches failures, and disables network in offline analysis", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    expect(await createDocumentLoader(false)("https://example.com/a")).toMatchObject({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
    const load = createDocumentLoader(true);
    expect(await load("https://example.com/a")).toMatchObject({ status: "http_403", text: "" });
    await load("https://example.com/a#same");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("reads plain text and rejects oversized or unsupported documents", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("verified &ldquo;quote&rdquo;", { headers: { "Content-Type": "text/plain" } }),
      )
      .mockResolvedValueOnce(new Response("pdf", { headers: { "Content-Type": "application/pdf" } }))
      .mockResolvedValueOnce(new Response("x".repeat(1_000_001), { headers: { "Content-Type": "text/plain" } }));
    vi.stubGlobal("fetch", fetch);
    const load = createDocumentLoader(true);
    expect(await load("https://example.com/text")).toEqual({ status: "fetched", text: "verified &ldquo;quote&rdquo;" });
    expect((await load("https://example.com/pdf")).status).toBe("unsupported_content");
    expect((await load("https://example.com/large")).status).toBe("size_limit");
  });
  it("upgrades a stored URL-only citation, preserves its ID, and distinguishes missing text from a wrong quote", async () => {
    const t = await setup("standard");
    const source = { url: "https://example.com/page", title: "https://example.com/page" };
    const initial = await prepareExternalProvenanceSources(t.env, t.owner, null, [source]);
    await t.env.DB.batch(initial.statements);
    const ref = {
      sourceUrl: source.url,
      sourceRef: null,
      inputPointer: null,
      quote: "ビッグ３の中心的存在",
      inferenceType: "direct" as const,
    };
    expect(await verifyEvidenceReference(ref, initial.sources, new Set([source.url]))).toMatchObject({
      issueReason: "source_unavailable",
    });
    const upgraded = await prepareExternalProvenanceSources(t.env, t.owner, null, [source], async () => ({
      text: "ビッグ３の中心的存在として紹介される。",
      status: "fetched",
    }));
    expect(upgraded.sources[0].sourceId).toBe(initial.sources[0].sourceId);
    expect(await verifyEvidenceReference(ref, upgraded.sources, new Set([source.url]))).toMatchObject({
      verificationStatus: "verified_quote",
    });
    expect(
      await verifyEvidenceReference({ ...ref, quote: "存在しない引用" }, upgraded.sources, new Set([source.url])),
    ).toMatchObject({ issueReason: "quote_not_found" });
    await t.env.DB.batch(upgraded.statements);
    const reload = await prepareExternalProvenanceSources(t.env, t.owner, null, [source], async () => {
      throw new Error("cached document must not refetch");
    });
    expect(reload.sources).toEqual(upgraded.sources);
  });
  it("reuses an existing excerpt without changing earlier quote offsets", async () => {
    const t = await setup("standard");
    const source = { url: "https://example.com/excerpt", title: "Page", excerpt: "Earlier verified quote" };
    const initial = await prepareExternalProvenanceSources(t.env, t.owner, null, [source]);
    await t.env.DB.batch(initial.statements);
    const load = vi.fn().mockResolvedValue({ text: "Changed page with a different prefix", status: "fetched" });
    const reused = await prepareExternalProvenanceSources(
      t.env,
      t.owner,
      null,
      [{ ...source, excerpt: "new excerpt" }],
      load,
    );
    expect(load).not.toHaveBeenCalled();
    expect(reused.sources).toEqual(initial.sources);
  });
  it("keeps prompt size independent of external body length while preserving quote verification", async () => {
    const source = {
      sourceId: "external",
      url: "https://example.com/page",
      inputPointer: null,
      origin: "source" as const,
      text: "verified quote",
    };
    const large = { ...source, text: source.text.repeat(10000) };
    expect(JSON.stringify(provenanceForPrompt([large]))).toBe(JSON.stringify(provenanceForPrompt([source])));
    expect(large.text).toHaveLength(source.text.length * 10000);
    expect(
      await verifyEvidenceReference(
        { sourceRef: null, sourceUrl: source.url, inputPointer: null, quote: source.text, inferenceType: "direct" },
        [large],
        new Set([source.url]),
      ),
    ).toMatchObject({ verificationStatus: "verified_quote" });
  });
  it.each(["standard", "dark"] as const)(
    "does not send persisted external bodies in actual %s preference audit messages",
    async (domain) => {
      const marker = "SERVER_ONLY_DOCUMENT_BODY_";
      const body = marker.repeat(8000);
      const t = await setup(domain, undefined, true, async (env, owner) => {
        const row = await env.DB.prepare("SELECT source_set_id FROM entry_revisions LIMIT 1").first<{
          source_set_id: string;
        }>();
        if (!row) throw new Error("missing source set");
        const sources = await prepareExternalProvenanceSources(env, owner, row.source_set_id, [
          { url: "https://example.com/full-document", title: "Full document", excerpt: body },
        ]);
        await env.DB.batch(sources.statements);
      });
      const audits = t.requests.filter((request) => request.operation.includes("preference_audit"));
      expect(audits).toHaveLength(1);
      const messages = JSON.stringify(audits[0].messages);
      expect(messages).toContain("https://example.com/full-document");
      expect(messages).not.toContain(marker);
      expect(messages).toContain(t.analysis.assertions[0].evidence[0].quote);
      expect(
        t.db.database.prepare("SELECT length(text_content) AS size FROM sources WHERE title='Full document'").get()
          ?.size,
      ).toBe(body.length);
    },
  );
});
