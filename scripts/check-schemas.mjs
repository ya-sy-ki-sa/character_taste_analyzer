import { readdirSync, readFileSync } from "node:fs";

const root = "docs/詳細設計/schemas";
const files = readdirSync(root)
  .filter((file) => file.endsWith(".json"))
  .sort();

function resolvePointer(document, pointer) {
  let current = document;
  for (const token of pointer
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    current = current?.[token];
  }
  return current;
}

function visit(document, value, path = "#") {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/") && !resolvePointer(document, value.$ref)) {
    throw new Error(`${path}: unresolved reference ${value.$ref}`);
  }
  for (const [key, child] of Object.entries(value)) visit(document, child, `${path}/${key}`);
}

for (const file of files) {
  const document = JSON.parse(readFileSync(`${root}/${file}`, "utf8"));
  if (document.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`${file}: Draft 2020-12 is required`);
  }
  visit(document, document);
}
console.log(`JSON Schema OK: ${files.length} files`);
