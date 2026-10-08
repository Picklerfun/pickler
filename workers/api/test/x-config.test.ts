import assert from "node:assert/strict";
import test from "node:test";
import { createXOAuthProvider } from "@pickler/infrastructure";
import { xOAuthConfiguration } from "../src/x-config.js";

const configured = {
  APP_ENV: "staging",
  X_CLIENT_ID: "controlled-client",
  X_CLIENT_SECRET: "controlled-secret",
  X_TOKEN_ENCRYPTION_KEY: "01".repeat(32),
  X_OAUTH_ENABLED: "true",
};

test("hosted OAuth uses its canonical callback and encryption version without extra variables", () => {
  for (const APP_ENV of ["staging", "production"]) {
    const config = xOAuthConfiguration({ ...configured, APP_ENV });
    const provider = createXOAuthProvider(config.provider);

    assert.equal(config.keyVersion, 1);
    assert.equal(provider.available, true);
    assert.equal(provider.readsAvailable, false);
    const url = new URL(provider.authorize("controlled-state", "controlled-challenge"));
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://app.pickler.fun/api/v1/studio/x/callback",
    );
  }
});

test("local consent needs its explicit loopback callback and never inherits the hosted one", () => {
  const local = xOAuthConfiguration({ ...configured, APP_ENV: "local" });
  assert.equal(local.provider.redirectUri, undefined);
  assert.equal(createXOAuthProvider(local.provider).available, false);

  const configuredLocal = xOAuthConfiguration({
    ...configured,
    APP_ENV: "local",
    X_REDIRECT_URI: "http://localhost:3004/api/v1/studio/x/callback",
  });
  assert.equal(createXOAuthProvider(configuredLocal.provider).available, true);
});

test("missing credentials or dedicated key and closed flags keep transports unavailable", () => {
  for (const field of [
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "X_TOKEN_ENCRYPTION_KEY",
    "X_OAUTH_ENABLED",
  ] as const) {
    const config = xOAuthConfiguration({ ...configured, [field]: undefined });
    assert.equal(createXOAuthProvider(config.provider).available, false);
  }
  assert.equal(xOAuthConfiguration({ APP_ENV: "staging" }).provider.enabled, false);
});

test("explicit invalid key versions cannot enable OAuth or fall back to version one", () => {
  for (const version of ["", "0", "-1", "01", "1.5", "no", "9007199254740992"]) {
    const config = xOAuthConfiguration({ ...configured, X_TOKEN_ENCRYPTION_KEY_VERSION: version });
    assert.equal(createXOAuthProvider(config.provider).available, false);
  }

  const rotated = xOAuthConfiguration({ ...configured, X_TOKEN_ENCRYPTION_KEY_VERSION: "2" });
  assert.equal(rotated.keyVersion, 2);
  assert.equal(createXOAuthProvider(rotated.provider).available, true);
});

test("explicit callbacks still pass strict provider validation", () => {
  const config = xOAuthConfiguration({
    ...configured,
    X_REDIRECT_URI: "https://attacker.invalid/callback",
  });
  assert.throws(() => createXOAuthProvider(config.provider), /Invalid X_REDIRECT_URI/);
});
