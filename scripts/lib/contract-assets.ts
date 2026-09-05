import { createHash } from "node:crypto";
import { z } from "zod";
import { publishedSchemas } from "../../shared/contracts/published";
import { promptRegistry } from "../../worker/llm/prompts/registry";
import { buildAsBuiltOpenApi } from "../../worker/openapi";

export function contractArtifacts() {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifacts = new Map<string, string>();
  artifacts.set("contracts/generated/openapi.json", json(buildAsBuiltOpenApi()));
  for (const [name, schema] of Object.entries(publishedSchemas)) {
    artifacts.set(
      `contracts/generated/schemas/${name}.schema.json`,
      json(z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", reused: "ref" })),
    );
  }
  artifacts.set(
    "contracts/generated/prompts.json",
    json(
      Object.fromEntries(
        Object.entries(promptRegistry).map(([name, contract]) => [
          name,
          { promptVersion: contract.promptVersion, sha256: createHash("sha256").update(contract.text).digest("hex") },
        ]),
      ),
    ),
  );
  return artifacts;
}
