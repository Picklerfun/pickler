import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-config-prettier/flat";
import nextTs from "eslint-config-next/typescript";

// The web app's layer rule, repeated by every block below that narrows it: in flat config a later
// block replaces a rule's options for the files it names, it does not add to them.
const WEB_LAYERS = ["@pickler/core", "@pickler/infrastructure"];

/* Mera and Turnkey never meet in code (docs/specs/mera-web-v1.md §4).
 *
 * Mera is the marketplace's passkey wallet: it turns a passkey's PRF output into a private key in
 * the page. Turnkey is the studio's custody: its passkeys authorise activities and must never be
 * read as key material. So the Mera SDK and the derivation are reachable from the Mera modules of
 * `features/wallet` and from nowhere else, those modules are reachable only from that feature, and
 * that feature reaches nothing of Turnkey's — no SDK, and nothing of the studio, account or auth
 * screens but the shared Supabase client.
 *
 * Each restriction is a static-import pattern and a selector for `import()`, because the Mera
 * modules load their libraries on demand and `no-restricted-imports` does not read `import()`. */
const MERA_SPEC = "docs/specs/mera-web-v1.md §4";
const MERA_PACKAGES = "^(@category-labs/mera|@pickler/mera-account)(/|$)";
const MERA_MODULES = "(^|/)wallet/lib/mera-";
const TURNKEY_PACKAGES = "^@turnkey/";
const STUDIO_SIDE =
  "^(@/features/|(\\.\\./)+)(auth|studio|account)/(?!lib/(supabase-browser|config)$)";

const NO_MERA_PACKAGES = `Only features/wallet/lib/mera-*.ts loads the Mera SDK or derives its account (${MERA_SPEC}).`;
const NO_MERA_MODULES = `The passkey wallet's modules are used inside features/wallet only; everything else goes through its wallet context (${MERA_SPEC}).`;
const NO_TURNKEY = `features/wallet never loads Turnkey: the marketplace's wallets are Mera and the browser wallet (${MERA_SPEC}).`;
const NO_STUDIO_SIDE = `features/wallet takes the Supabase client from features/auth and nothing else from the studio's side: no custody, passkey or signing module (${MERA_SPEC}).`;

const restricted = (...patterns) => ["error", { patterns: [{ group: WEB_LAYERS }, ...patterns] }];
const dynamic = (...entries) => [
  "error",
  ...entries.map(([regex, message]) => ({
    selector: `ImportExpression[source.value=/${regex.replaceAll("/", "\\/")}/]`,
    message,
  })),
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  { rules: { curly: ["error", "all"] } },
  { settings: { next: { rootDir: "apps/web/" } } },
  globalIgnores([
    "**/.next/**",
    "**/.open-next/**",
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
    // Vendored Solidity dependencies; they carry their own JavaScript tooling.
    "contracts/lib/**",
    // Imported with the mobile app; linted by its own tooling, not this configuration.
    "apps/mobile/**",
    "services/reads/**",
    "infra/**",
    "docs/mobile/**",
    "scripts/mobile/**",
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
            "@pickler/trading",
            "@pickler/trading/*",
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
    files: ["packages/trading/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "node:*",
            "next",
            "next/*",
            "react",
            "@mastra/*",
            "@ai-sdk/*",
            "@pickler/infrastructure",
            "@pickler/infrastructure/*",
            "@pickler/agent-runtime",
            "@pickler/agent-runtime/*",
            "@pickler/api-schema",
            "@pickler/web",
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
      "no-restricted-imports": restricted(
        { regex: MERA_PACKAGES, message: NO_MERA_PACKAGES },
        { regex: MERA_MODULES, message: NO_MERA_MODULES },
      ),
      "no-restricted-syntax": dynamic(
        [MERA_PACKAGES, NO_MERA_PACKAGES],
        [MERA_MODULES, NO_MERA_MODULES],
      ),
    },
  },
  {
    files: ["apps/web/src/features/wallet/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restricted(
        { regex: MERA_PACKAGES, message: NO_MERA_PACKAGES },
        { regex: TURNKEY_PACKAGES, message: NO_TURNKEY },
        { regex: STUDIO_SIDE, message: NO_STUDIO_SIDE },
      ),
      "no-restricted-syntax": dynamic(
        [MERA_PACKAGES, NO_MERA_PACKAGES],
        [TURNKEY_PACKAGES, NO_TURNKEY],
        [STUDIO_SIDE, NO_STUDIO_SIDE],
      ),
    },
  },
  {
    files: ["apps/web/src/features/wallet/lib/mera-*.ts"],
    rules: {
      "no-restricted-imports": restricted(
        { regex: TURNKEY_PACKAGES, message: NO_TURNKEY },
        { regex: STUDIO_SIDE, message: NO_STUDIO_SIDE },
      ),
      "no-restricted-syntax": dynamic(
        [TURNKEY_PACKAGES, NO_TURNKEY],
        [STUDIO_SIDE, NO_STUDIO_SIDE],
      ),
    },
  },
]);
