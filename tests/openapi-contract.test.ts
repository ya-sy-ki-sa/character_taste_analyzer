import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { app } from "../worker/app";
import { buildAsBuiltOpenApi } from "../worker/openapi";

const outputPath = resolve("contracts/generated/openapi.json");

describe("as-built OpenAPI contract", () => {
  it("matches the routes and Zod schemas used by the implementation", () => {
    const generated = `${JSON.stringify(buildAsBuiltOpenApi(), null, 2)}\n`;
    expect(readFileSync(outputPath, "utf8")).toBe(generated);
  });

  it("contains every concrete Hono route and no documentation-only route", () => {
    // Hono registers validators and handlers separately for the same endpoint.
    const actual = [
      ...new Set(
        app.routes
          .filter((route) => route.method !== "ALL")
          .map((route) => `${route.method} ${route.path.replace(/:([^/]+)/gu, "{$1}")}`),
      ),
    ].sort();
    const documented = Object.entries(buildAsBuiltOpenApi().paths ?? {}).flatMap(([path, methods]) =>
      Object.keys(methods ?? {})
        .filter((method) => ["get", "post", "delete"].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented.sort()).toEqual(actual);
  });

  it("does not expose removed compatibility contracts", () => {
    const document = buildAsBuiltOpenApi();
    const serialized = JSON.stringify(document);
    expect(document.paths).not.toHaveProperty("/api/v1/account/key-rotation");
    expect(document.paths?.["/api/v1/users"]).not.toHaveProperty("get");
    expect(serialized).not.toContain("knownScope");
    expect(serialized).not.toContain("sourceText");
    expect(serialized).not.toContain("legacy_unverified");
  });
});
