import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "json", "html"],
      include: [
        "src/lib/**/*.ts",
        "worker/lib/numbers.ts",
        "worker/services/analysis-result-policy.ts",
        "worker/services/generation-validation.ts",
        "worker/services/job-policy.ts",
        "worker/services/profile-context.ts",
        "worker/services/provenance-verifier.ts",
        "worker/services/quota-policy.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
        "worker/services/{generation-validation,job-policy,provenance-verifier,quota-policy}.ts": {
          branches: 90,
        },
      },
    },
  },
});
