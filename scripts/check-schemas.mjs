import { readdirSync, readFileSync } from "node:fs";

const root = "contracts/generated/schemas";
function visit(document, value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
    const resolved = value.$ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce((current, part) => current?.[part], document);
    if (!resolved) throw new Error(`Unresolved reference ${value.$ref}`);
  }
  for (const child of Object.values(value)) visit(document, child);
}
const files = readdirSync(root).filter((file) => file.endsWith(".schema.json"));
for (const file of files) {
  const document = JSON.parse(readFileSync(`${root}/${file}`, "utf8"));
  if (document.$schema !== "https://json-schema.org/draft/2020-12/schema")
    throw new Error(`${file}: unexpected JSON Schema version`);
  visit(document, document);
}
console.log(`JSON Schema references OK: ${files.length} contracts`);
