import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { ontologyArtifacts } from "./generate-ontology.mjs";
import { writeOrCheckArtifacts } from "./lib/generated-files.mjs";

const check = process.argv.includes("--check");
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
try {
  const { contractArtifacts } = await server.ssrLoadModule("/scripts/lib/contract-assets.ts");
  const artifacts = new Map([...ontologyArtifacts(), ...contractArtifacts()]);
  const manifestPath = "contracts/generated/prompts.json";
  const baselineRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD";
  const baseline = spawnSync("git", ["show", `${baselineRef}:${manifestPath}`], { encoding: "utf8" });
  if (baseline.status === 0) {
    const previous = JSON.parse(baseline.stdout);
    for (const [name, contract] of Object.entries(JSON.parse(artifacts.get(manifestPath)))) {
      if (previous[name]?.sha256 !== contract.sha256 && previous[name]?.promptVersion === contract.promptVersion)
        throw new Error(`Prompt ${name} changed without updating its version`);
    }
  }
  writeOrCheckArtifacts(artifacts, check);
} finally {
  await server.close();
}
