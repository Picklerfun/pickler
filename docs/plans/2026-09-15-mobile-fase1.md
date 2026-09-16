# App móvil Pickler — Fase 1: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Expo/iOS que crea o abre una cuenta EVM en Monad Testnet con passkey (Mera), muestra balance de AUSD y MON, pide AUSD al faucet de Agora, y sube a TestFlight.

**Architecture:** Sin backend. El passkey vive en el iPhone; Mera deriva 32 bytes (PRF) → BIP-39/BIP-32 → llave secp256k1 → cuenta viem. El secreto se guarda en SecureStore con gate biométrico; la dirección sin gate. Un sitio estático en `pickler.fun` sirve el `apple-app-site-association` que iOS exige para los passkeys.

**Tech Stack:** Expo SDK 57 (bare vía `expo prebuild`), React Native 0.86, TypeScript, `@category-labs/mera` 0.2.0, `react-native-passkey` 3.6.1, `viem` 2.55.13, `expo-secure-store`, `expo-crypto`, `@scure/bip32` + `@scure/bip39`, Jest (`jest-expo`). Cloudflare Pages para el dominio. Xcode 26.2 + App Store Connect API key para TestFlight.

**Spec:** `docs/specs/2026-09-15-mobile-fase1-design.md`

## Global Constraints

- Red: **Monad Testnet, chain id 10143**, RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadexplorer.com`.
- AUSD testnet: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, **6 decimales** (verificado por RPC 2026-09-15).
- Faucet AUSD: `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`, `requestFunds(address)`.
- rpId: **`pickler.fun`**. Bundle ID: **`fun.pickler.app`**. Team Apple: **`2PBQJ37Q8W`**.
- Idioma de la app: inglés. Solo iPhone, portrait.
- Versiones **exactas** en `package.json` (sin `^`), como en Proflores.
- `apps/mobile/ios/` y `apps/mobile/android/` se generan; **no se versionan**.
- Módulos `config/`, `wallet/`, `storage/`, `hd/` no importan React. `ui/` no importa viem ni mera.
- Nada se commitea sin autorización de Jesús (`global.md`). Los pasos "Commit" de este plan asumen que esa autorización se dio al arrancar la ejecución; si no, se dejan pendientes y se listan en el handoff. **Nunca `git add -A`.**
- Toolchain medido: Node 22.22, npm 10.9, Xcode 26.2, simulador iOS 18.6, ASC key `MQMB7256MK` en `~/.appstoreconnect/private_keys/`.

## Precondición

El repo `predict` no tiene commits. Antes de la Task 1, Jesús autoriza el commit inicial de `README.md`, `.gitignore`, `docs/` en `main` (`git add README.md .gitignore docs && git commit -m "docs: diseño y spec de fase 1 móvil"`). Sin ese commit no se puede crear un worktree; si no se autoriza, el trabajo se hace en el checkout principal y se declara en el handoff.

## Mapa de archivos

```
apps/mobile/
  package.json, tsconfig.json, app.config.ts, index.ts, App.tsx
  babel.config.js, jest.config.js
  src/polyfills.ts            crypto.getRandomValues para Hermes
  src/config/chain.ts         chain, direcciones, ABI mínimo, formateo    [puro]
  src/hd/hd.ts                PRF → mnemonic → seed → llave EVM             [puro]
  src/storage/storage.ts      SecureStore: address (sin gate), PRF (gate)  [puro salvo SecureStore]
  src/wallet/wallet.ts        mera: create / signIn / unlock / describeError
  src/wallet/chain.ts         viem: balances y tx al faucet                 [puro, recibe cliente]
  src/account.ts              AccountState + helpers                        [puro]
  src/ui/theme.ts, src/ui/Button.tsx, src/ui/Field.tsx
  src/screens/Welcome.tsx, src/screens/Home.tsx
  __tests__/chain.test.ts, hd.test.ts, storage.test.ts, account.test.ts, faucet.test.ts
  scripts/ios-archive.sh, scripts/ios-upload.sh, ExportOptions.plist, .env.asc (gitignored)
  README.md
infra/passkey-domain/
  public/.well-known/apple-app-site-association
  wrangler.jsonc, README.md
docs/04-roadmap-bounty.md
.gitignore (raíz: + .wrangler/, apps/mobile/ios, apps/mobile/android, .env.asc)
```

---

### Task 1: Scaffold Expo + verificación de toolchain

**Files:**
- Create: `apps/mobile/` (create-expo-app), `apps/mobile/app.config.ts`, `apps/mobile/src/polyfills.ts`, `apps/mobile/index.ts`, `apps/mobile/jest.config.js`
- Modify: `.gitignore` (raíz)

**Interfaces:**
- Produces: `Constants.expoConfig.extra.rpId: string` leído por Task 5; app compilando en simulador.

- [ ] **Step 1: Crear la app**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict
npx create-expo-app@latest apps/mobile --template blank-typescript --no-install
cd apps/mobile
npm install
```

- [ ] **Step 2: Instalar dependencias con versiones compatibles con el SDK y luego fijarlas**

```bash
npx expo install expo-secure-store expo-crypto expo-constants expo-clipboard react-native-safe-area-context
npm install @category-labs/mera@0.2.0 react-native-passkey@3.6.1 viem@2.55.13 @scure/base@2.3.0 @scure/bip32@2.3.0 @scure/bip39@2.3.0
npm install -D jest@~29.7.0 jest-expo @types/jest
# Quitar todos los ^ y ~ de package.json (dependencies y devDependencies):
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));
for (const k of ["dependencies","devDependencies"]) for (const d in p[k]) p[k][d]=p[k][d].replace(/^[\^~]/,"");
fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");'
npm install
```

Anotar en el commit las versiones exactas que quedaron (`expo`, `react-native`, `react`).

- [ ] **Step 3: Config de la app**

`apps/mobile/app.config.ts`:

```ts
import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
const bundleIdentifier = "fun.pickler.app";

const config: ExpoConfig = {
  name: "Pickler",
  slug: "pickler-mobile",
  version: "0.1.0",
  orientation: "portrait",
  ios: {
    bundleIdentifier,
    buildNumber: "1",
    supportsTablet: false,
    associatedDomains: [`webcredentials:${rpId}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    [
      "expo-secure-store",
      {
        faceIDPermission:
          "Pickler uses Face ID to unlock the account stored on this device.",
      },
    ],
  ],
  extra: { rpId },
};

export default config;
```

Borrar `app.json` (el `app.config.ts` lo reemplaza).

- [ ] **Step 4: Polyfill y entrada**

`apps/mobile/src/polyfills.ts`:

```ts
import { getRandomValues } from "expo-crypto";

// Hermes no trae CSPRNG; mera exige crypto.getRandomValues. Importar antes que
// cualquier otro módulo de la app.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
```

`apps/mobile/index.ts`:

```ts
import "./src/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
```

En `package.json` poner `"main": "index.ts"`.

- [ ] **Step 5: Jest**

`apps/mobile/jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@category-labs/.*|viem|@scure/.*|@noble/.*)",
  ],
};
```

Agregar script `"test": "jest"` en `package.json`. Crear `__tests__/smoke.test.ts`:

```ts
test("jest runs", () => {
  expect(1 + 1).toBe(2);
});
```

Run: `npm test` → Expected: 1 passed.

- [ ] **Step 6: gitignore**

Agregar al `.gitignore` de la raíz:

```
.wrangler/
apps/mobile/ios/
apps/mobile/android/
apps/mobile/.expo/
apps/mobile/build/
apps/mobile/.env.asc
```

- [ ] **Step 7: Prebuild y build en simulador (verifica Expo 57 + Xcode 26.2)**

```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios --device "iPhone 16"   # o el nombre que liste `xcrun simctl list devices available`
```

Expected: la app abre en el simulador con la pantalla "Open up App.tsx". Si `run:ios` falla por CocoaPods o por versión de Xcode, **parar y reportar** — es el riesgo declarado en el spec §10.

- [ ] **Step 8: Commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict
git add .gitignore apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/tsconfig.json apps/mobile/app.config.ts apps/mobile/index.ts apps/mobile/App.tsx apps/mobile/babel.config.js apps/mobile/jest.config.js apps/mobile/src/polyfills.ts apps/mobile/__tests__/smoke.test.ts apps/mobile/assets
git commit -m "feat(mobile): scaffold Expo con mera, viem y jest"
```

---

### Task 2: Config de cadena y formateo

**Files:**
- Create: `apps/mobile/src/config/chain.ts`
- Test: `apps/mobile/__tests__/chain.test.ts`

**Interfaces:**
- Produces: `CHAIN` (viem `Chain`), `AUSD_ADDRESS`, `AUSD_DECIMALS = 6`, `AUSD_FAUCET_ADDRESS`, `ERC20_ABI`, `FAUCET_ABI`, `EXPLORER_TX_URL(hash: string): string`, `formatAusd(raw: bigint): string`, `formatMon(raw: bigint): string`.

- [ ] **Step 1: Test que falla**

`apps/mobile/__tests__/chain.test.ts`:

```ts
import {
  AUSD_ADDRESS,
  AUSD_DECIMALS,
  AUSD_FAUCET_ADDRESS,
  CHAIN,
  EXPLORER_TX_URL,
  formatAusd,
  formatMon,
} from "../src/config/chain";

test("chain is Monad Testnet", () => {
  expect(CHAIN.id).toBe(10143);
  expect(CHAIN.rpcUrls.default.http[0]).toBe("https://testnet-rpc.monad.xyz");
});

test("AUSD testnet address and decimals match Agora docs", () => {
  expect(AUSD_ADDRESS).toBe("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
  expect(AUSD_DECIMALS).toBe(6);
  expect(AUSD_FAUCET_ADDRESS).toBe("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
});

test("formatAusd shows two decimals", () => {
  expect(formatAusd(0n)).toBe("0.00");
  expect(formatAusd(1_500_000n)).toBe("1.50");
  expect(formatAusd(123_456_789n)).toBe("123.45");
});

test("formatMon shows four decimals", () => {
  expect(formatMon(0n)).toBe("0.0000");
  expect(formatMon(1_234_500_000_000_000_000n)).toBe("1.2345");
});

test("explorer url points to a tx", () => {
  expect(EXPLORER_TX_URL("0xabc")).toBe("https://testnet.monadexplorer.com/tx/0xabc");
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd apps/mobile && npm test -- chain` → Expected: FAIL, "Cannot find module '../src/config/chain'".

- [ ] **Step 3: Implementar**

`apps/mobile/src/config/chain.ts`:

```ts
import { formatUnits, parseAbi, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const CHAIN = monadTestnet;

// docs.agora.finance/developer/contract-deployments — verificado por RPC 2026-09-15.
export const AUSD_ADDRESS: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const AUSD_DECIMALS = 6;
export const AUSD_FAUCET_ADDRESS: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export const FAUCET_ABI = parseAbi([
  "function requestFunds(address recipient)",
]);

export const MON_FAUCET_URL = "https://faucet.monad.xyz";

export function EXPLORER_TX_URL(hash: string): string {
  return `${CHAIN.blockExplorers.default.url}/tx/${hash}`;
}

function truncate(value: string, places: number): string {
  const [whole, frac = ""] = value.split(".");
  return `${whole}.${(frac + "0".repeat(places)).slice(0, places)}`;
}

export function formatAusd(raw: bigint): string {
  return truncate(formatUnits(raw, AUSD_DECIMALS), 2);
}

export function formatMon(raw: bigint): string {
  return truncate(formatUnits(raw, CHAIN.nativeCurrency.decimals), 4);
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- chain` → Expected: 5 passed.

- [ ] **Step 5: Probar contra el defecto**

Cambiar temporalmente `AUSD_DECIMALS = 18` y correr: Expected: fallan "decimals" y "formatAusd". Revertir.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/config/chain.ts apps/mobile/__tests__/chain.test.ts
git commit -m "feat(mobile): config de Monad testnet, AUSD y faucet"
```

---

### Task 3: Dominio de passkeys en Cloudflare Pages

**Files:**
- Create: `infra/passkey-domain/public/.well-known/apple-app-site-association`, `infra/passkey-domain/public/index.html`, `infra/passkey-domain/wrangler.jsonc`, `infra/passkey-domain/README.md`

**Interfaces:**
- Produces: `https://pickler.fun/.well-known/apple-app-site-association` → 200 JSON sin redirect, con `2PBQJ37Q8W.fun.pickler.app`.

- [ ] **Step 1: Archivos**

`infra/passkey-domain/public/.well-known/apple-app-site-association` (sin extensión, JSON):

```json
{
  "webcredentials": {
    "apps": ["2PBQJ37Q8W.fun.pickler.app"]
  }
}
```

`infra/passkey-domain/public/index.html`:

```html
<!doctype html><meta charset="utf-8"><title>Pickler</title><p>Pickler — coming soon.</p>
```

`infra/passkey-domain/public/_headers` (Pages lo lee; fuerza el content-type que Apple exige):

```
/.well-known/apple-app-site-association
  Content-Type: application/json
```

`infra/passkey-domain/wrangler.jsonc`:

```jsonc
{
  "name": "pickler-passkeys",
  "account_id": "1e08efc05d1cf361b372ba3009ed4985",
  "pages_build_output_dir": "public"
}
```

- [ ] **Step 2: Deploy (cuenta Pickler, login OAuth de wrangler)**

```bash
cd infra/passkey-domain
CLOUDFLARE_ACCOUNT_ID=1e08efc05d1cf361b372ba3009ed4985 npx wrangler pages project create pickler-passkeys --production-branch main
CLOUDFLARE_ACCOUNT_ID=1e08efc05d1cf361b372ba3009ed4985 npx wrangler pages deploy public --project-name pickler-passkeys --branch main
```

Expected: URL `https://pickler-passkeys.pages.dev`. Verificar: `curl -sI https://pickler-passkeys.pages.dev/.well-known/apple-app-site-association | head -5` → `200`, `content-type: application/json`.

- [ ] **Step 3: Custom domain `pickler.fun`**

Wrangler no expone custom domains de Pages; se hace por API con el token OAuth **o** en el dashboard: cuenta Pickler → Workers & Pages → `pickler-passkeys` → Custom domains → Set up → `pickler.fun`. Cloudflare crea el CNAME y el certificado (la zona está vacía; no hay conflicto). Si el dashboard lo hace Jesús, anotar la hora.

- [ ] **Step 4: Verificar en el dominio final**

```bash
curl -sI https://pickler.fun/.well-known/apple-app-site-association
curl -s  https://pickler.fun/.well-known/apple-app-site-association
```

Expected: `HTTP/2 200`, `content-type: application/json`, **sin** `location:`, cuerpo con `2PBQJ37Q8W.fun.pickler.app`. El certificado puede tardar unos minutos.

- [ ] **Step 5: README + commit**

`infra/passkey-domain/README.md`: qué es, cómo se despliega (los dos comandos), cómo se verifica (el curl), y la advertencia: *cambiar el rpId invalida los passkeys existentes*.

```bash
git add infra/passkey-domain
git commit -m "feat(infra): dominio de passkeys pickler.fun en Cloudflare Pages"
```

---

### Task 4: Derivación HD (PRF → cuenta EVM)

**Files:**
- Create: `apps/mobile/src/hd/hd.ts`
- Test: `apps/mobile/__tests__/hd.test.ts`

**Interfaces:**
- Produces: `prfOutputToMnemonic(prf: Uint8Array): string`, `mnemonicToSeed(m: string): Uint8Array`, `deriveEvmPrivateKey(seed: Uint8Array, index: number): Uint8Array`.
- Es la misma derivación del demo oficial de Mera (`demos/shared/src/hd.ts`): así el mismo passkey da la **misma dirección** en el demo web de mera y en Pickler.

- [ ] **Step 1: Test que falla**

`apps/mobile/__tests__/hd.test.ts`:

```ts
import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../src/hd/hd";

const prf = new Uint8Array(32).fill(7);

test("32 bytes of PRF become a 24-word mnemonic", () => {
  const words = prfOutputToMnemonic(prf).split(" ");
  expect(words).toHaveLength(24);
});

test("rejects PRF output that is not 32 bytes", () => {
  expect(() => prfOutputToMnemonic(new Uint8Array(31))).toThrow("32 bytes");
});

test("derivation is deterministic and yields a valid EVM account", () => {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prf));
  const k1 = deriveEvmPrivateKey(seed, 0);
  const k2 = deriveEvmPrivateKey(mnemonicToSeed(prfOutputToMnemonic(prf)), 0);
  expect(toHex(k1)).toBe(toHex(k2));
  expect(k1).toHaveLength(32);
  const account = privateKeyToAccount(toHex(k1));
  expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
});

test("index 1 differs from index 0", () => {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prf));
  expect(toHex(deriveEvmPrivateKey(seed, 1))).not.toBe(toHex(deriveEvmPrivateKey(seed, 0)));
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- hd` → Expected: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar**

`apps/mobile/src/hd/hd.ts`:

```ts
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const PRF_OUTPUT_LENGTH = 32;

// BIP-44, coin type 60 (Ethereum), convención MetaMask. Cambiar esto cambia
// todas las direcciones derivadas.
const evmPath = (index: number): string => `m/44'/60'/0'/0/${index}`;

/** 32 bytes de PRF como 256 bits de entropía BIP-39 (misma regla que el demo de mera). */
export function prfOutputToMnemonic(prfOutput: Uint8Array): string {
  if (prfOutput.length !== PRF_OUTPUT_LENGTH) {
    throw new Error("PRF output must be 32 bytes");
  }
  return entropyToMnemonic(prfOutput, wordlist);
}

/** Seed BIP-39 de 64 bytes (PBKDF2, passphrase vacía). */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
}

/** Llave privada secp256k1 de la cuenta EVM `index`. */
export function deriveEvmPrivateKey(seed: Uint8Array, index: number): Uint8Array {
  const node = HDKey.fromMasterSeed(seed).derive(evmPath(index));
  if (!node.privateKey) {
    throw new Error("BIP-32 derivation produced no private key");
  }
  return node.privateKey;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- hd` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hd/hd.ts apps/mobile/__tests__/hd.test.ts
git commit -m "feat(mobile): derivación HD compatible con el demo de mera"
```

---

### Task 5: Storage (SecureStore) y estado de cuenta

**Files:**
- Create: `apps/mobile/src/storage/storage.ts`, `apps/mobile/src/account.ts`
- Test: `apps/mobile/__tests__/storage.test.ts`, `apps/mobile/__tests__/account.test.ts`

**Interfaces:**
- Produces (storage): `parseStoredAccount(raw: string): StoredAccount | undefined`, `loadStoredAccount(): Promise<StoredAccount | undefined>`, `saveStoredAccount(a: StoredAccount): Promise<void>`, `storePrfResult(r: { credentialId: string; prfOutput: Uint8Array }): Promise<void>`, `readStoredPrfResult(): Promise<{ credentialId: string; prfOutput: Uint8Array } | undefined>`, `clearStoredAccount(): Promise<void>`. `type StoredAccount = { address: \`0x${string}\`; credentialId: string }`.
- Produces (account): `type AccountState = { status: "none" } | { status: "locked"; address; credentialId } | { status: "unlocked"; wallet: Wallet }`, `accountAddress(state): Address | null`. `Wallet` viene de Task 6 — aquí se declara como `import type { Wallet } from "./wallet/wallet"`; el archivo de Task 6 aún no existe, así que **en esta task** se crea un stub `src/wallet/wallet.ts` con solo `export type Wallet = { address: \`0x${string}\`; credentialId: string; session: { end(): void } };` que Task 6 reemplaza.

- [ ] **Step 1: Tests que fallan**

`apps/mobile/__tests__/storage.test.ts`:

```ts
import { parseStoredAccount } from "../src/storage/storage";

test("parses a valid stored account", () => {
  const raw = JSON.stringify({
    address: "0x1111111111111111111111111111111111111111",
    credentialId: "abc-DEF_123",
  });
  expect(parseStoredAccount(raw)).toEqual({
    address: "0x1111111111111111111111111111111111111111",
    credentialId: "abc-DEF_123",
  });
});

test.each([
  ["not json", "{"],
  ["bad address", JSON.stringify({ address: "0x12", credentialId: "a" })],
  ["bad credential chars", JSON.stringify({ address: "0x1111111111111111111111111111111111111111", credentialId: "a b" })],
  ["missing fields", JSON.stringify({})],
])("rejects %s", (_, raw) => {
  expect(parseStoredAccount(raw)).toBeUndefined();
});
```

`apps/mobile/__tests__/account.test.ts`:

```ts
import { accountAddress, type AccountState } from "../src/account";

const address = "0x2222222222222222222222222222222222222222" as const;

test("none has no address", () => {
  expect(accountAddress({ status: "none" })).toBeNull();
});

test("locked exposes stored address", () => {
  const s: AccountState = { status: "locked", address, credentialId: "c" };
  expect(accountAddress(s)).toBe(address);
});

test("unlocked exposes wallet address", () => {
  const s: AccountState = {
    status: "unlocked",
    wallet: { address, credentialId: "c", session: { end() {} } } as never,
  };
  expect(accountAddress(s)).toBe(address);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm test -- storage account` → Expected: FAIL, módulos no encontrados.

- [ ] **Step 3: Implementar storage**

`apps/mobile/src/storage/storage.ts`:

```ts
import type { EvmAddress } from "@category-labs/mera";
import { base64urlnopad } from "@scure/base";
import {
  deleteItemAsync,
  getItemAsync,
  type SecureStoreOptions,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "expo-secure-store";

const PRF_KEY = "pickler.prf.v1";
const ACCOUNT_KEY = "pickler.account.v1";
const PRF_OUTPUT_LENGTH = 32;

// Leer el PRF pide Face ID / passcode: es el secreto del que sale la llave.
const PRF_ITEM_OPTIONS = {
  requireAuthentication: true,
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  authenticationPrompt: "Unlock your Pickler account",
} satisfies SecureStoreOptions;

// La dirección no es secreta: se lee sin prompt para pintar Home al arrancar.
const UNGATED_ITEM_OPTIONS = {
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} satisfies SecureStoreOptions;

export type StoredAccount = { address: EvmAddress; credentialId: string };
export type StoredPrf = { credentialId: string; prfOutput: Uint8Array };

export function parseStoredAccount(raw: string): StoredAccount | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const { address, credentialId } = value as Record<string, unknown>;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    typeof credentialId !== "string" ||
    credentialId.length > 2_048 ||
    !/^[A-Za-z0-9_-]+$/.test(credentialId)
  ) {
    return undefined;
  }
  return { address: address as EvmAddress, credentialId };
}

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadStoredAccount(): Promise<StoredAccount | undefined> {
  const raw = await getItemAsync(ACCOUNT_KEY);
  if (raw === null) return undefined;
  const account = parseStoredAccount(raw);
  if (account === undefined) await deleteItemAsync(ACCOUNT_KEY);
  return account;
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await setItemAsync(ACCOUNT_KEY, JSON.stringify(account), UNGATED_ITEM_OPTIONS);
}

export async function storePrfResult(result: StoredPrf): Promise<void> {
  const stored = {
    credentialId: result.credentialId,
    prfOutput: base64urlnopad.encode(result.prfOutput),
  };
  await setItemAsync(PRF_KEY, JSON.stringify(stored), PRF_ITEM_OPTIONS);
}

/** Lanza si el usuario cancela la autenticación o el dato está corrupto. */
export async function readStoredPrfResult(): Promise<StoredPrf | undefined> {
  const stored = await getItemAsync(PRF_KEY, PRF_ITEM_OPTIONS);
  if (stored === null) return undefined;
  const { credentialId, prfOutput } = JSON.parse(stored) as Partial<{
    credentialId: string;
    prfOutput: string;
  }>;
  if (typeof credentialId !== "string" || typeof prfOutput !== "string") {
    throw new Error("Stored PRF result is malformed");
  }
  const bytes = new Uint8Array(base64urlnopad.decode(prfOutput));
  if (bytes.length !== PRF_OUTPUT_LENGTH) {
    throw new Error("Stored PRF output must be 32 bytes");
  }
  return { credentialId, prfOutput: bytes };
}

export async function clearStoredAccount(): Promise<void> {
  await deleteItemAsync(PRF_KEY);
  await deleteItemAsync(ACCOUNT_KEY);
}
```

- [ ] **Step 4: Implementar account + stub de wallet**

`apps/mobile/src/wallet/wallet.ts` (stub; Task 6 lo reemplaza):

```ts
import type { EvmAddress } from "@category-labs/mera";

export type Wallet = {
  address: EvmAddress;
  credentialId: string;
  session: { end(): void };
};
```

`apps/mobile/src/account.ts`:

```ts
import type { EvmAddress } from "@category-labs/mera";
import type { Wallet } from "./wallet/wallet";

export type AccountState =
  | { status: "none" }
  | { status: "locked"; address: EvmAddress; credentialId: string }
  | { status: "unlocked"; wallet: Wallet };

export function accountAddress(account: AccountState): EvmAddress | null {
  switch (account.status) {
    case "none":
      return null;
    case "locked":
      return account.address;
    case "unlocked":
      return account.wallet.address;
  }
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm test -- storage account` → Expected: 8 passed. Si jest falla al importar `expo-secure-store` en el test de storage, agregar en `jest.config.js`: `moduleNameMapper: { "^expo-secure-store$": "<rootDir>/__tests__/__mocks__/expo-secure-store.ts" }` con un mock que exporte `getItemAsync`, `setItemAsync`, `deleteItemAsync` como `jest.fn()` y `WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/storage/storage.ts apps/mobile/src/account.ts apps/mobile/src/wallet/wallet.ts apps/mobile/__tests__/storage.test.ts apps/mobile/__tests__/account.test.ts
git commit -m "feat(mobile): storage con gate biométrico y estado de cuenta"
```

---

### Task 6: Wallet con Mera (crear, entrar, desbloquear, errores)

**Files:**
- Modify: `apps/mobile/src/wallet/wallet.ts` (reemplaza el stub)
- Create: `apps/mobile/src/config/rp.ts`

**Interfaces:**
- Consumes: `hd.ts` (Task 4), `storage.ts` (Task 5), `Constants.expoConfig.extra.rpId` (Task 1).
- Produces: `type Wallet = { address: EvmAddress; credentialId: string; session: Secp256k1SigningSession; account: LocalAccount }`, `createAccount(): Promise<Wallet>`, `signIn(): Promise<Wallet>`, `unlockStoredWallet(): Promise<Wallet | undefined>`, `describeError(e: unknown): string`.

- [ ] **Step 1: rpId**

`apps/mobile/src/config/rp.ts`:

```ts
import Constants from "expo-constants";

const rpId = Constants.expoConfig?.extra?.rpId;
if (typeof rpId !== "string") {
  throw new Error("app.config.ts supplied no rpId");
}

export const RP_ID = rpId;
export const RP_NAME = "Pickler";
```

- [ ] **Step 2: Implementar wallet**

`apps/mobile/src/wallet/wallet.ts`:

```ts
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  type EvmAddress,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { toViemAccount } from "@category-labs/mera/viem";
import type { PasskeyError } from "react-native-passkey";
import { BaseError as ViemError, type LocalAccount } from "viem";
import { RP_ID, RP_NAME } from "../config/rp";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../hd/hd";
import {
  readStoredPrfResult,
  saveStoredAccount,
  type StoredPrf,
  storePrfResult,
} from "../storage/storage";

export type Wallet = {
  address: EvmAddress;
  credentialId: string;
  session: Secp256k1SigningSession;
  account: LocalAccount;
};

const USER_NAME = "pickler";
const displayName = (): string => `Pickler ${new Date().toLocaleDateString()}`;

export async function createAccount(): Promise<Wallet> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: RP_NAME },
    user: { name: USER_NAME, displayName: displayName() },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return storeAndOpen(created);
}

/** Sin credential fijada: iOS ofrece todos los passkeys de pickler.fun. */
export async function signIn(): Promise<Wallet> {
  const asserted = await getPasskeyPrfOutput({
    rpId: RP_ID,
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return storeAndOpen(asserted);
}

/** Lee el PRF guardado (pide Face ID) y re-deriva; sin prompt de passkey. */
export async function unlockStoredWallet(): Promise<Wallet | undefined> {
  const stored = await readStoredPrfResult();
  return stored === undefined ? undefined : toWallet(stored);
}

async function storeAndOpen(result: StoredPrf): Promise<Wallet> {
  await storePrfResult(result);
  const wallet = toWallet(result);
  try {
    await saveStoredAccount({ address: wallet.address, credentialId: wallet.credentialId });
  } catch (error) {
    wallet.session.end();
    throw error;
  }
  return wallet;
}

/** Limpia los buffers de llave tras derivar. */
function toWallet({ credentialId, prfOutput }: StoredPrf): Wallet {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prfOutput));
  prfOutput.fill(0);
  let privateKey: Uint8Array | undefined;
  try {
    privateKey = deriveEvmPrivateKey(seed, 0);
    const session = createSecp256k1SigningSession({ privateKey });
    return {
      address: getEvmAddress(session.publicKey),
      credentialId,
      session,
      account: toViemAccount(session),
    };
  } finally {
    seed.fill(0);
    privateKey?.fill(0);
  }
}

export function describeError(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This device can't create a passkey with PRF. Use an iPhone with iOS 18 or newer.";
      case "PASSKEY_OPERATION_FAILED":
        return describePasskeyFailure(error.cause);
      case "SESSION_ENDED":
        return "The session has ended. Unlock again.";
      case "CRYPTO_UNAVAILABLE":
        return "The runtime provides no secure random source.";
      default:
        return error.message;
    }
  }
  if (error instanceof ViemError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

function describePasskeyFailure(cause: unknown): string {
  const { error, message } = (cause ?? {}) as Partial<PasskeyError>;
  switch (error) {
    case "RequestFailed":
      return `iOS refused a passkey for ${RP_ID}. Check that https://${RP_ID}/.well-known/apple-app-site-association names this app.`;
    case "NoCredentials":
      return "No passkey for Pickler on this device. Create an account first.";
    case "UserCancelled":
      return "";
    default:
      return typeof message === "string" ? message : "The passkey request failed.";
  }
}
```

Nota: `describeError` devuelve `""` cuando el usuario canceló; la UI (Task 8) trata `""` como "sin error".

- [ ] **Step 3: Typecheck y tests existentes**

Run: `npx tsc --noEmit && npm test` → Expected: sin errores de tipo; los 18 tests anteriores siguen en verde.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/wallet/wallet.ts apps/mobile/src/config/rp.ts
git commit -m "feat(mobile): cuenta EVM desde passkey con mera"
```

---

### Task 7: Balances y tx al faucet (viem)

**Files:**
- Create: `apps/mobile/src/wallet/chain.ts`
- Test: `apps/mobile/__tests__/faucet.test.ts`

**Interfaces:**
- Consumes: `chain.ts` (Task 2), `Wallet.account` (Task 6).
- Produces: `publicClient` (viem `PublicClient`), `readBalances(address): Promise<{ ausd: bigint; mon: bigint }>`, `requestAusdFromFaucet(wallet: Wallet): Promise<\`0x${string}\`>` (hash), `faucetCalldata(recipient): Hex`.

- [ ] **Step 1: Test que falla**

`apps/mobile/__tests__/faucet.test.ts`:

```ts
import { encodeFunctionData } from "viem";
import { AUSD_FAUCET_ADDRESS, FAUCET_ABI } from "../src/config/chain";
import { faucetCalldata, faucetTxRequest } from "../src/wallet/chain";

const recipient = "0x3333333333333333333333333333333333333333" as const;

test("faucet calldata is requestFunds(recipient)", () => {
  expect(faucetCalldata(recipient)).toBe(
    encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [recipient] }),
  );
  // selector de requestFunds(address), calculado con viem y verificado por
  // eth_call contra el faucet en testnet el 2026-09-15 (no revierte).
  expect(faucetCalldata(recipient).slice(0, 10)).toBe("0x544c7cf9");
});

test("faucet tx targets the faucet with zero value", () => {
  const tx = faucetTxRequest(recipient);
  expect(tx.to).toBe(AUSD_FAUCET_ADDRESS);
  expect(tx.value).toBe(0n);
  expect(tx.data).toBe(faucetCalldata(recipient));
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- faucet` → Expected: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar**

`apps/mobile/src/wallet/chain.ts`:

```ts
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
} from "viem";
import { AUSD_ADDRESS, AUSD_FAUCET_ADDRESS, CHAIN, ERC20_ABI, FAUCET_ABI } from "../config/chain";
import type { Wallet } from "./wallet";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

export async function readBalances(address: Address): Promise<{ ausd: bigint; mon: bigint }> {
  const [ausd, mon] = await Promise.all([
    publicClient.readContract({
      address: AUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.getBalance({ address }),
  ]);
  return { ausd, mon };
}

export function faucetCalldata(recipient: Address): Hex {
  return encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [recipient] });
}

export function faucetTxRequest(recipient: Address): { to: Address; data: Hex; value: bigint } {
  return { to: AUSD_FAUCET_ADDRESS, data: faucetCalldata(recipient), value: 0n };
}

/** Firma con la sesión de mera (sin prompt de passkey) y envía. Devuelve el hash. */
export async function requestAusdFromFaucet(wallet: Wallet): Promise<Hex> {
  const walletClient = createWalletClient({ account: wallet.account, chain: CHAIN, transport: http() });
  const tx = faucetTxRequest(wallet.address);
  return walletClient.sendTransaction({ ...tx, account: wallet.account, chain: CHAIN });
}

export async function waitForReceipt(hash: Hex): Promise<"success" | "reverted"> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.status;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- faucet` → Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/wallet/chain.ts apps/mobile/__tests__/faucet.test.ts
git commit -m "feat(mobile): balances de AUSD/MON y tx al faucet de Agora"
```

---

### Task 8: UI — Welcome, Home y App

**Files:**
- Create: `apps/mobile/src/ui/theme.ts`, `apps/mobile/src/ui/Button.tsx`, `apps/mobile/src/ui/Field.tsx`, `apps/mobile/src/screens/Welcome.tsx`, `apps/mobile/src/screens/Home.tsx`
- Modify: `apps/mobile/App.tsx` (reemplazar el generado)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la app completa de fase 1.

- [ ] **Step 1: Tema y componentes**

`apps/mobile/src/ui/theme.ts`:

```ts
export const palette = {
  bg: "#0B0B0F",
  card: "#16161D",
  text: "#F4F4F5",
  muted: "#9A9AA6",
  accent: "#8B5CF6",
  danger: "#F87171",
  success: "#4ADE80",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
```

`apps/mobile/src/ui/Button.tsx`:

```tsx
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { palette, spacing } from "./theme";

type Props = {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

export function Button({ title, onPress, busy, disabled, variant = "primary" }: Props) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={[styles.base, variant === "secondary" && styles.secondary, off && styles.off]}
    >
      {busy ? <ActivityIndicator color={palette.text} /> : <Text style={styles.label}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: palette.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: "center",
  },
  secondary: { backgroundColor: palette.card },
  off: { opacity: 0.5 },
  label: { color: palette.text, fontSize: 16, fontWeight: "600" },
});
```

`apps/mobile/src/ui/Field.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";
import { palette, spacing } from "./theme";

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: palette.card, padding: spacing.md, borderRadius: 12, gap: spacing.xs },
  label: { color: palette.muted, fontSize: 13 },
  value: { color: palette.text, fontSize: 22, fontVariant: ["tabular-nums"] },
});
```

- [ ] **Step 2: Welcome**

`apps/mobile/src/screens/Welcome.tsx`:

```tsx
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { palette, spacing } from "../ui/theme";
import { createAccount, describeError, signIn, type Wallet } from "../wallet/wallet";

export function Welcome({ onWallet }: { onWallet: (w: Wallet) => void }) {
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [error, setError] = useState("");

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setError("");
    try {
      onWallet(kind === "create" ? await createAccount() : await signIn());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pickler</Text>
      <Text style={styles.sub}>Agents that trade in public. Sign in with Face ID — no seed phrase.</Text>
      <Button title="Create account" onPress={() => run("create")} busy={busy === "create"} disabled={busy !== null} />
      <Button title="Sign in with passkey" variant="secondary" onPress={() => run("signin")} busy={busy === "signin"} disabled={busy !== null} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { color: palette.text, fontSize: 40, fontWeight: "700" },
  sub: { color: palette.muted, fontSize: 16, marginBottom: spacing.lg },
  error: { color: palette.danger },
});
```

- [ ] **Step 3: Home**

`apps/mobile/src/screens/Home.tsx`:

```tsx
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { accountAddress, type AccountState } from "../account";
import { EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL } from "../config/chain";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { palette, spacing } from "../ui/theme";
import { readBalances, requestAusdFromFaucet, waitForReceipt } from "../wallet/chain";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

type Props = {
  account: Exclude<AccountState, { status: "none" }>;
  onUnlock: (w: Wallet) => void;
  onLock: () => void;
  onSignOut: () => void;
};

export function Home({ account, onUnlock, onLock, onSignOut }: Props) {
  const address = accountAddress(account)!;
  const [balances, setBalances] = useState<{ ausd: bigint; mon: bigint } | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRpcError("");
    try {
      setBalances(await readBalances(address));
    } catch (e) {
      setBalances(null);
      setRpcError(describeError(e));
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function getTestAusd() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let wallet: Wallet;
      if (account.status === "unlocked") {
        wallet = account.wallet;
      } else {
        const unlocked = await unlockStoredWallet();
        if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
        wallet = unlocked;
        onUnlock(wallet);
      }
      if (balances && balances.mon === 0n) {
        throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
      }
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await waitForReceipt(hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
      await refresh();
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const txHash = notice.split(": ")[1];

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Treasury</Text>
      <Field label="Address (Monad Testnet)" value={address} />
      <Button title="Copy address" variant="secondary" onPress={() => Clipboard.setStringAsync(address)} />
      <Field label="AUSD" value={balances ? formatAusd(balances.ausd) : "—"} />
      <Field label="MON (gas)" value={balances ? formatMon(balances.mon) : "—"} />
      {rpcError ? (
        <>
          <Text style={styles.error}>{rpcError}</Text>
          <Button title="Retry" variant="secondary" onPress={refresh} />
        </>
      ) : null}
      <Button title="Get test AUSD" onPress={getTestAusd} busy={busy} />
      <Button title="Get test MON (opens faucet)" variant="secondary" onPress={() => Linking.openURL(MON_FAUCET_URL)} />
      {notice ? (
        <Text style={styles.notice} onPress={() => txHash && Linking.openURL(EXPLORER_TX_URL(txHash))}>
          {notice}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Text style={styles.status}>{account.status === "unlocked" ? "Unlocked" : "Locked"}</Text>
        {account.status === "unlocked" ? <Button title="Lock" variant="secondary" onPress={onLock} /> : null}
        <Button title="Sign out" variant="secondary" onPress={onSignOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.sm, padding: spacing.lg },
  title: { color: palette.text, fontSize: 28, fontWeight: "700", marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: "auto" },
  status: { color: palette.muted, flex: 1 },
  notice: { color: palette.success, fontSize: 12 },
  error: { color: palette.danger },
});
```

- [ ] **Step 4: App (máquina de estados)**

`apps/mobile/App.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { AccountState } from "./src/account";
import { Home } from "./src/screens/Home";
import { Welcome } from "./src/screens/Welcome";
import { clearStoredAccount, loadStoredAccount } from "./src/storage/storage";
import { palette } from "./src/ui/theme";
import type { Wallet } from "./src/wallet/wallet";

export default function App() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const ref = useRef(account);
  ref.current = account;

  // Termina la sesión de firma saliente cuando la wallet deja el estado.
  const replace = useCallback((next: AccountState) => {
    const cur = ref.current;
    if (cur?.status === "unlocked" && (next.status !== "unlocked" || next.wallet !== cur.wallet)) {
      cur.wallet.session.end();
    }
    ref.current = next;
    setAccount(next);
  }, []);

  // Arranque: solo la dirección (sin gate). Nada de Face ID aquí.
  useEffect(() => {
    let stale = false;
    loadStoredAccount()
      .then((s) => !stale && setAccount(s ? { status: "locked", ...s } : { status: "none" }))
      .catch(() => !stale && setAccount({ status: "none" }));
    return () => {
      stale = true;
    };
  }, []);

  const onWallet = (wallet: Wallet) => replace({ status: "unlocked", wallet });
  const onLock = () => {
    const cur = ref.current;
    if (cur?.status === "unlocked") {
      replace({ status: "locked", address: cur.wallet.address, credentialId: cur.wallet.credentialId });
    }
  };
  const onSignOut = async () => {
    await clearStoredAccount();
    replace({ status: "none" });
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.root}>
        {account === null ? (
          <View style={styles.center}><ActivityIndicator color={palette.text} /></View>
        ) : account.status === "none" ? (
          <Welcome onWallet={onWallet} />
        ) : (
          <Home account={account} onUnlock={onWallet} onLock={onLock} onSignOut={onSignOut} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: "center" },
});
```

- [ ] **Step 5: Typecheck + tests + simulador**

```bash
cd apps/mobile && npx tsc --noEmit && npm test
npx expo prebuild --platform ios --clean && npx expo run:ios --device "iPhone 16"
```

Expected: tipos limpios, 20 tests en verde, app abre en Welcome. En el simulador iOS 18.6: *Create account* → hoja de passkey de iOS → Home con dirección y balances `0.00` / `0.0000`. Tomar captura (`xcrun simctl io booted screenshot /tmp/claude-501/.../welcome.png` y `home.png`). Cerrar y reabrir la app: debe abrir en Home **sin** pedir Face ID (estado Locked).

Si el simulador no ofrece PRF (error `PRF_UNAVAILABLE` o `RequestFailed`), anotar el mensaje exacto y pasar a device en Task 9 — no "arreglar" a ciegas.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/App.tsx apps/mobile/src/ui apps/mobile/src/screens
git commit -m "feat(mobile): pantallas Welcome y Home con tesorería AUSD"
```

---

### Task 9: Device, faucet real y TestFlight

**Files:**
- Create: `apps/mobile/scripts/ios-archive.sh`, `apps/mobile/scripts/ios-upload.sh`, `apps/mobile/ExportOptions.plist`, `apps/mobile/.env.asc` (gitignored), `apps/mobile/README.md`

**Interfaces:**
- Consumes: la app de Task 8, el dominio de Task 3, la ASC key de Proflores.
- Produces: build en TestFlight; tx del faucet confirmada.

- [ ] **Step 1: Pasos manuales de Jesús (una sola vez)**

1. App Store Connect → *Apps* → **+** → New App: plataforma iOS, nombre `Pickler`, idioma primario English (U.S.), Bundle ID `fun.pickler.app` (si no aparece en la lista, primero correr el Step 2, que lo registra), SKU `pickler-ios`.
2. Confirmar en developer.apple.com → *Identificadores* que `fun.pickler.app` tiene **Associated Domains** habilitado (el Step 2 lo hace; verificar).
3. Conectar el iPhone y confiar en la Mac.

- [ ] **Step 2: Build de device (registra el App ID con la capability)**

```bash
cd apps/mobile
cp ../../../Proflores/proflores-monorepo/apps/ios/.env.asc .env.asc   # misma key, mismo team
npx expo prebuild --platform ios --clean
set -a; . ./.env.asc; set +a
xcodebuild -workspace ios/Pickler.xcworkspace -scheme Pickler \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates \
  -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" \
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM=2PBQJ37Q8W build
```

Expected: BUILD SUCCEEDED; en developer.apple.com aparece `fun.pickler.app` con Associated Domains. Luego `npx expo run:ios --device` y elegir el iPhone físico.

- [ ] **Step 3: Flujo completo en device**

1. *Create account* con Face ID → Home con dirección.
2. Copiar dirección; en `https://faucet.monad.xyz` pedir MON de testnet para esa dirección (o Jesús manda ~0.1 MON desde su wallet). Refrescar: MON > 0.
3. *Get test AUSD* → Face ID (lee el PRF) → "Sent: 0x…" → "Confirmed: 0x…" → AUSD > 0.
4. Abrir el hash en el explorer y capturar.
5. *Lock* → *Get test AUSD* de nuevo → debe pedir Face ID otra vez.
6. *Sign out* → Welcome → *Sign in with passkey* → misma dirección.

Registrar: dirección, hash de la tx, capturas. Si el faucet revierte, leer la razón en el explorer y anotarla (rate-limit por dirección es lo esperable).

- [ ] **Step 4: Scripts de archive/upload (adaptados de Proflores)**

`apps/mobile/ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>2PBQJ37Q8W</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
```

`apps/mobile/scripts/ios-archive.sh`:

```bash
#!/usr/bin/env bash
# Archive + export del .ipa. Lecciones heredadas de Proflores (2026-08-18):
# clean archive siempre; verificar identidad Apple Distribution ANTES de archivar.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

_k="${ASC_KEY_ID-}"; _i="${ASC_ISSUER_ID-}"
if [ -f .env.asc ]; then set -a; . ./.env.asc; set +a; fi
[ -n "$_k" ] && ASC_KEY_ID="$_k"; [ -n "$_i" ] && ASC_ISSUER_ID="$_i"
: "${ASC_KEY_ID:?falta ASC_KEY_ID — ver .env.asc}"
: "${ASC_ISSUER_ID:?falta ASC_ISSUER_ID — ver .env.asc}"
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$KEY_PATH" ] || { echo "❌ no existe $KEY_PATH"; exit 1; }

if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "❌ no hay identidad 'Apple Distribution' en el llavero; App Store Connect rechazará el .ipa."
  echo "   Xcode → Settings → Accounts → Manage Certificates → + → Apple Distribution."
  exit 1
fi

rm -rf build
npx expo prebuild --platform ios --clean

xcodebuild -workspace ios/Pickler.xcworkspace -scheme Pickler \
  -destination 'generic/platform=iOS' \
  -archivePath build/Pickler.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM=2PBQJ37Q8W \
  clean archive

xcodebuild -exportArchive \
  -archivePath build/Pickler.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "✓ $DIR/build/export/Pickler.ipa"
```

`apps/mobile/scripts/ios-upload.sh`:

```bash
#!/usr/bin/env bash
# altool SALE CON 0 aunque la subida falle (medido en Proflores 2026-08-18): se grep-ea la salida.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IPA="$DIR/build/export/Pickler.ipa"
_k="${ASC_KEY_ID-}"; _i="${ASC_ISSUER_ID-}"
if [ -f "$DIR/.env.asc" ]; then set -a; . "$DIR/.env.asc"; set +a; fi
[ -n "$_k" ] && ASC_KEY_ID="$_k"; [ -n "$_i" ] && ASC_ISSUER_ID="$_i"
: "${ASC_KEY_ID:?}"; : "${ASC_ISSUER_ID:?}"
[ -f "$IPA" ] || { echo "❌ no existe $IPA — corre scripts/ios-archive.sh"; exit 1; }

OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
set +e
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tee "$OUT"
set -e
if grep -qiE "UPLOAD FAILED|ERROR ITMS|Validation failed" "$OUT"; then
  echo "❌ la subida FALLÓ (altool salió con 0 de todos modos)."; exit 1
fi
echo "✓ subida aceptada"
```

`chmod +x scripts/*.sh`. Agregar a `package.json`: `"ios:archive": "scripts/ios-archive.sh"`, `"ios:upload": "scripts/ios-upload.sh"`.

- [ ] **Step 5: Archive + upload**

```bash
npm run ios:archive && npm run ios:upload
```

Expected: "✓ subida aceptada". En App Store Connect → TestFlight aparece el build `0.1.0 (1)` en "Processing" y luego listo. Agregar a Jesús al grupo interno de testers. **Cada subida siguiente necesita subir `ios.buildNumber` en `app.config.ts`.**

- [ ] **Step 6: README de la app + commit**

`apps/mobile/README.md` con: qué es (fase 1), cómo correr en simulador (los 3 comandos), cómo correr tests, el dominio de passkeys y cómo verificarlo, cómo subir a TestFlight (los dos scripts + regla del buildNumber), y dónde conseguir MON de testnet.

```bash
git add apps/mobile/scripts apps/mobile/ExportOptions.plist apps/mobile/README.md apps/mobile/package.json
git commit -m "chore(mobile): scripts de archive/upload a TestFlight"
```

---

### Task 10: Documentación del roadmap del bounty

**Files:**
- Create: `docs/04-roadmap-bounty.md`
- Modify: `README.md` (raíz): quitar "No hay código todavía", enlazar `apps/mobile` y el roadmap.

- [ ] **Step 1: Escribir el roadmap**

`docs/04-roadmap-bounty.md` con exactamente estas secciones: (1) el bounty en 5 líneas (premio, deadline 13 oct 2026 21:59 CST, las tres integraciones, criterios de jueces, deliverable); (2) tabla de fases — Fase 1 hecha (passkey + AUSD), Fase 2 Perpl testnet (`createAccount`, `allowOrderForwarding(true)`, WS `/ws/v1/trading`, una orden desde la app — **obligatoria para elegibilidad**), Fase 3 agentes + launchpad, Fase 4 harness con orden rechazada y comprobante; (3) decisiones que la fase 2 abre en `02-decisiones-abiertas.md` (venue Perpl vs Polymarket, D-01/D-02/D-12); (4) enlaces: bounty, docs de Perpl, Agora, Mera.

- [ ] **Step 2: README raíz**

Reemplazar la sección "Estado: diseño. No hay código todavía." por "Estado: fase 1 móvil en construcción" con enlace a `apps/mobile/README.md`, al spec y al roadmap.

- [ ] **Step 3: Commit**

```bash
git add docs/04-roadmap-bounty.md README.md
git commit -m "docs: roadmap del bounty y estado del repo"
```

---

## Handoff al cerrar la fase

Evidencia que debe existir antes de decir "fase 1 lista": salida de `npm test` (20 tests), `curl -sI https://pickler.fun/.well-known/apple-app-site-association`, capturas de simulador y device, hash de la tx del faucet en el explorer, build visible en TestFlight. Pendientes conocidos: fase 2 (Perpl) es obligatoria para el bounty; decisión de venue en el equipo.
