import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "browser",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.tsx", "tests/http.test.ts"],
        },
      },
      {
        test: { name: "server", environment: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/http.test.ts"] },
      },
    ],
    coverage: {
      reporter: ["text", "json", "html"],
      include: [
        "src/lib/**/*.ts",
        "worker/lib/numbers.ts",
        "worker/features/analysis/result-policy.ts",
        "worker/features/generation/validation.ts",
        "worker/features/jobs/policy.ts",
        "worker/features/profile/context.ts",
        "worker/platform/provenance/verifier.ts",
        "worker/platform/quota/policy.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
        "worker/{features/generation/validation,features/jobs/policy,platform/provenance/verifier,platform/quota/policy}.ts":
          {
            branches: 90,
          },
      },
    },
  },
});
