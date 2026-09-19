import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-config-prettier/flat";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  { rules: { curly: ["error", "all"] } },
  { settings: { next: { rootDir: "apps/web/" } } },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/.mastra/**",
    "**/.turbo/**",
    "**/.wrangler/**",
    "**/.data/**",
    "supabase/.temp/**",
    "supabase/.branches/**",
    "**/next-env.d.ts",
    "contracts/out/**",
    "contracts/cache/**",
  ]),
  {
    files: [
      "packages/core/**/*.{ts,tsx}",
      "packages/api-schema/**/*.{ts,tsx}",
      "packages/chain/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "next",
            "next/*",
            "react",
            "@pickler/infrastructure",
            "@pickler/ui",
            "@pickler/web",
            "@pickler/core",
            "@pickler/api-schema",
            "@pickler/chain",
            "@mastra/*",
            "@ai-sdk/*",
          ],
        },
      ],
    },
  },
  {
    files: ["packages/infrastructure/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["next", "next/*", "react", "@pickler/ui", "@pickler/web"] },
      ],
    },
  },
  {
    files: ["packages/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["@pickler/core", "@pickler/infrastructure", "@pickler/web", "next", "next/*"],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@pickler/core", "@pickler/infrastructure"] },
      ],
    },
  },
]);
