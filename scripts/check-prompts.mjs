import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = "docs/詳細設計/prompt-contracts.json";
const sources = {
  preferenceHypotheses: {
    file: "worker/services/preference-hypotheses.ts",
    constant: "HYPOTHESIS_SYSTEM",
    version: "preference_hypotheses/v2.1.0",
  },
  darkAnalysis: {
    file: "worker/services/analysis.ts",
    constant: "DARK_SYSTEM_INSTRUCTION",
    version: "dark_analysis/v2.0.0",
  },
  darkGeneration: {
    file: "worker/services/generation.ts",
    constant: "DARK_GENERATION_SYSTEM",
    version: "dark_generation/v2.0.0",
  },
  analysis: {
    file: "worker/services/analysis.ts",
    constant: "SYSTEM_INSTRUCTION",
    version: "character_understanding/v2.0.0",
  },
  generation: {
    file: "worker/services/generation.ts",
    constant: "GENERATION_SYSTEM",
    version: "character_generation/v2.0.0",
  },
  generationValidation: {
    file: "worker/services/generation.ts",
    constant: "GENERATION_VALIDATION_SYSTEM",
    version: "generation_validation/v2.0.0",
  },
};
const generated = {};
for (const [key, source] of Object.entries(sources)) {
  const text = readFileSync(source.file, "utf8");
  const expression = new RegExp(`const ${source.constant} = \`([\\s\\S]*?)\`;`, "u");
  const prompt = text.match(expression)?.[1];
  if (!prompt) throw new Error(`prompt constant not found: ${source.constant}`);
  generated[key] = {
    promptVersion: source.version,
    sha256: createHash("sha256").update(prompt).digest("hex"),
  };
}
const output = `${JSON.stringify(generated, null, 2)}\n`;
if (process.env.UPDATE_PROMPTS === "1") writeFileSync(manifestPath, output);
if (readFileSync(manifestPath, "utf8") !== output)
  throw new Error("prompt hash changed without updating its version and prompt-contracts.json");

const baselineRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD";
const baselineResult = spawnSync("git", ["show", `${baselineRef}:${manifestPath}`], { encoding: "utf8" });
if (baselineResult.status === 0) {
  const baseline = JSON.parse(baselineResult.stdout);
  for (const [key, contract] of Object.entries(generated)) {
    const previous = baseline[key];
    if (previous?.sha256 !== contract.sha256 && previous?.promptVersion === contract.promptVersion)
      throw new Error(`prompt ${key} changed without incrementing promptVersion`);
  }
}
console.log("Prompt contracts OK");
