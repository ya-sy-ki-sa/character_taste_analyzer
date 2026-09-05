import { relative } from "node:path";
import type { Plugin } from "vite";

export function buildDependencies(): Plugin {
  return {
    name: "build-dependencies",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => ({
          file: chunk.fileName,
          entry: chunk.isEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.keys(chunk.modules).map((id) => relative(process.cwd(), id).replaceAll("\\", "/")),
        }));
      this.emitFile({
        type: "asset",
        fileName: "build-dependencies.json",
        source: JSON.stringify({ chunks }, null, 2) + "\n",
      });
    },
  };
}
