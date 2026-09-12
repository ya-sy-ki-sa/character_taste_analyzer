import { decodeHTML } from "entities/decode";

/** Verification-only document retrieval. Never append this text to LLM requests. */
export type DocumentResult = { text: string; status: string };
export type DocumentLoader = (url: string) => Promise<DocumentResult>;
const MAX_BYTES = 1_000_000;

export function publicDocumentUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/u.test(host)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export async function documentText(html: string): Promise<string> {
  // Remove non-document contents first; a second pass collects only retained text.
  const cleaned = await new HTMLRewriter()
    .on("script,style,template,noscript", {
      element(element) {
        element.remove();
      },
    })
    .transform(new Response(html))
    .text();
  let text = "";
  await new HTMLRewriter()
    .on("br", {
      element() {
        text += "\n";
      },
    })
    .on("p,div,li,h1,h2,h3,h4,section,article,tr", {
      element(element) {
        text += "\n";
        element.onEndTag(() => {
          text += "\n";
        });
      },
    })
    .onDocument({
      text(chunk) {
        text += chunk.text;
      },
    })
    .transform(new Response(cleaned))
    .text();
  // HTMLRewriter exposes encoded text. Decode once, preserving literal markup.
  return decodeHTML(text).trim();
}

export function createDocumentLoader(enabled: boolean): DocumentLoader {
  const cache = new Map<string, Promise<DocumentResult>>();
  return (value) => {
    if (!enabled) return Promise.resolve({ text: "", status: "disabled" });
    const key = value.split("#")[0];
    const cached = cache.get(key);
    if (cached) return cached;
    // One analysis can cite many pages; bound total requests and memory as well as each response.
    if (cache.size >= 24) return Promise.resolve({ text: "", status: "document_limit" });
    const pending = fetchDocument(key);
    cache.set(key, pending);
    return pending;
  };
}

async function fetchDocument(value: string): Promise<DocumentResult> {
  const url = publicDocumentUrl(value);
  if (!url) return { text: "", status: "url_rejected" };
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8_000);
  try {
    // No credentials or automatic redirects to a different destination.
    const response = await fetch(url, {
      redirect: "manual",
      signal: abort.signal,
      headers: { Accept: "text/html,text/plain", "User-Agent": "CharacterTasteLab/1.0 (citation verification)" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { text: "", status: `http_${response.status}` };
    }
    const mime = response.headers.get("content-type")?.split(";")[0].trim();
    if (mime !== "text/html" && mime !== "text/plain") {
      await response.body?.cancel();
      return { text: "", status: "unsupported_content" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { text: "", status: "empty" };
    const decoder = new TextDecoder();
    let size = 0;
    let body = "";
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { text: "", status: "size_limit" };
      }
      body += decoder.decode(chunk, { stream: true });
    }
    body += decoder.decode();
    const text = mime === "text/html" ? await documentText(body) : body.trim();
    return { text, status: text ? "fetched" : "empty" };
  } catch {
    return { text: "", status: abort.signal.aborted ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
