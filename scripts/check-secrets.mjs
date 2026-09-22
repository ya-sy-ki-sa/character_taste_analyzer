import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.startsWith(".dev.vars") && !file.startsWith("node_modules/") && !file.startsWith("dist/"));
const patterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  /OPENAI_API_KEY\s*=\s*[^\s"'<>{}]{12,}/gu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
];
const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(text))) findings.push(file);
  for (const pattern of patterns) pattern.lastIndex = 0;
}
if (findings.length) throw new Error(`secret-like values found: ${findings.join(", ")}`);
console.log(`Secret scan OK: ${files.length} files`);
