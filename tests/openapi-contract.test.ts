import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { asBuiltRouteKeys, buildAsBuiltOpenApi } from "../worker/openapi";

const outputPath = resolve("docs/詳細設計/api/openapi.as-built.json");

describe("as-built OpenAPI contract", () => {
  it("matches the routes and Zod schemas used by the implementation", () => {
    const generated = `${JSON.stringify(buildAsBuiltOpenApi(), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI === "1") writeFileSync(outputPath, generated);
    expect(readFileSync(outputPath, "utf8")).toBe(generated);
  });

  it("contains every concrete Hono route and no documentation-only route", () => {
    const implementation = readFileSync(resolve("worker/index.ts"), "utf8");
    const actual = [...implementation.matchAll(/app\.(get|post|delete)\(\s*["']([^"']+)["']/gu)]
      .map((match) => `${match[1].toUpperCase()} ${match[2].replace(/:([^/]+)/gu, "{$1}")}`)
      .sort();
    expect([...asBuiltRouteKeys].sort()).toEqual(actual);
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
