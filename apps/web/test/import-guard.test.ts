import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ESLint } from "eslint";

// Mera and Turnkey never meet in code (docs/specs/mera-web-v1.md §4). The guard is configuration,
// and configuration that stopped matching reports what configuration that passes reports. So this
// lints snippets as if they sat at the paths the guard names, with the repository's own
// configuration, and reads which of them it refuses.

const ROOT = path.resolve(__dirname, "../../..");
const GUARDS = ["no-restricted-imports", "no-restricted-syntax"];

let eslint: ESLint | null = null;

/** The guard's complaints about `code` as if it were the file at `file`, a path from the root. */
async function refused(file: string, code: string): Promise<string[]> {
  eslint ??= new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  assert.ok(result, `${file} was not linted`);

  // A file ESLint ignored or could not parse reports no guard message either.
  const fatal = result.messages.filter((message) => message.fatal);
  assert.deepEqual(fatal, [], `${file} did not parse`);
  assert.equal(
    result.messages.some((message) => /ignored/i.test(message.message)),
    false,
    `${file} is ignored by the configuration`,
  );

  return result.messages
    .filter((message) => message.ruleId !== null && GUARDS.includes(message.ruleId))
    .map((message) => message.message);
}

const WALLET = "apps/web/src/features/wallet/lib/connect.ts";
const WALLET_SCREEN = "apps/web/src/features/wallet/components/connect-modal.tsx";
const MERA_MODULE = "apps/web/src/features/wallet/lib/mera-kit.ts";

test("the wallet feature cannot load Turnkey, statically or on demand", async () => {
  const fixed = await refused(
    WALLET,
    `import { WebauthnStamper } from "@turnkey/webauthn-stamper";`,
  );
  const onDemand = await refused(
    WALLET,
    `export const load = () => import("@turnkey/sdk-browser");`,
  );
  const inMera = await refused(MERA_MODULE, `import { Turnkey } from "@turnkey/sdk-browser";`);
  const inMeraOnDemand = await refused(MERA_MODULE, `void import("@turnkey/http");`);

  for (const messages of [fixed, onDemand, inMera, inMeraOnDemand]) {
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /never loads Turnkey/);
  }
});

test("the wallet feature takes nothing from the studio's side but the Supabase client", async () => {
  const refusedOnes = [
    `import { landing } from "@/features/auth/lib/custody";`,
    `import { createWallet } from "@/features/auth/lib/ceremony";`,
    `import { custody } from "@/features/studio/lib/passkey";`,
    `import { runCeremony } from "../../studio/create/ceremony";`,
    `import { Account } from "@/features/account/account";`,
    `void import("@/features/auth/lib/webauthn");`,
  ];
  for (const code of refusedOnes) {
    const messages = await refused(WALLET, code);
    assert.equal(messages.length, 1, code);
    assert.match(messages[0]!, /nothing else from the studio's side/);
  }
  assert.equal(
    (await refused(MERA_MODULE, `import { session } from "@/features/studio/lib/passkey";`)).length,
    1,
  );

  const allowed = [
    `import { getSupabase } from "@/features/auth/lib/supabase-browser";`,
    `import { supabaseConfigured } from "../../auth/lib/config";`,
    `import { shortAddress } from "./provider";`,
    `import { useWallet } from "@/features/wallet/lib/wallet-context";`,
  ];
  for (const code of allowed) {
    assert.deepEqual(await refused(WALLET, code), [], code);
  }
});

test("only the Mera modules load the Mera SDK and the derivation", async () => {
  const elsewhere = [
    "apps/web/src/features/auth/lib/custody.ts",
    "apps/web/src/features/studio/lib/passkey.ts",
    "apps/web/src/features/account/account.tsx",
    "apps/web/src/features/markets/components/trade-ticket.tsx",
    "apps/web/src/features/wallet/lib/wallet-context.tsx",
    WALLET_SCREEN,
  ];
  const imports = [
    `import { getPasskeyPrfOutput } from "@category-labs/mera";`,
    `import { toViemAccount } from "@category-labs/mera/viem";`,
    `import { privateKeyFromPrfOutput } from "@pickler/mera-account";`,
    `export const load = () => import("@category-labs/mera");`,
    `export const load = () => import("@pickler/mera-account");`,
  ];
  for (const file of elsewhere) {
    for (const code of imports) {
      const messages = await refused(file, code);
      assert.equal(messages.length, 1, `${file}: ${code}`);
      assert.match(messages[0]!, /Only features\/wallet\/lib\/mera-\*\.ts/);
    }
  }

  for (const code of imports) {
    assert.deepEqual(await refused(MERA_MODULE, code), [], code);
  }
});

test("the Mera modules are used inside the wallet feature only", async () => {
  const outside = [
    "apps/web/src/features/auth/components/passkey-flow.tsx",
    "apps/web/src/features/studio/create/create.tsx",
    "apps/web/src/features/account/account.tsx",
    "apps/web/src/features/agents/components/ask-flow.tsx",
    "apps/web/src/app/portfolio/page.tsx",
  ];
  const imports = [
    `import { meraSigner } from "@/features/wallet/lib/mera-signer";`,
    `import { runMeraCeremony } from "../../wallet/lib/mera-ceremony";`,
    `void import("@/features/wallet/lib/mera-kit");`,
  ];
  for (const file of outside) {
    for (const code of imports) {
      const messages = await refused(file, code);
      assert.equal(messages.length, 1, `${file}: ${code}`);
      assert.match(messages[0]!, /inside features\/wallet only/);
    }
    assert.deepEqual(
      await refused(file, `import { useWallet } from "@/features/wallet/lib/wallet-context";`),
      [],
    );
  }

  assert.deepEqual(
    await refused(WALLET_SCREEN, `import { meraSigner } from "../lib/mera-signer";`),
    [],
  );
  assert.deepEqual(
    await refused(
      "apps/web/src/features/wallet/lib/wallet-context.tsx",
      `import { PrfUnavailableError } from "./mera-ceremony";`,
    ),
    [],
  );
});

test("narrowing the rule for the wallet did not drop the layer rule there", async () => {
  for (const file of [WALLET, MERA_MODULE, "apps/web/src/features/auth/lib/custody.ts"]) {
    assert.equal((await refused(file, `import { verify } from "@pickler/core";`)).length, 1, file);
    assert.equal(
      (await refused(file, `import { db } from "@pickler/infrastructure";`)).length,
      1,
      file,
    );
  }
});
