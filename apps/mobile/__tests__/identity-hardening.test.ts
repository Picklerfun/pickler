import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { call, describeIdentityError, type DoFetch, IdentityError } from "../src/identity/api";
import { checkSignInMessage, SIGN_IN_STATEMENT, signInWithWallet } from "../src/identity/session";
import { appQuiet, gateShows, perplOnboardingActive } from "../src/identity/state";

// Tres cosas que la revisión de #78 dejó pendientes: el deadline del cliente cubre también el body; la pantalla
// obligatoria no cae encima del onboarding de Perpl; y la app no firma nada que no sea el mensaje de entrada de SU
// dirección (la misma ruta de la API emite el mensaje de «Link wallet …», que deja entrar a otra wallet a la cuenta).

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const OTHER = "0x2222222222222222222222222222222222222222";
const BASE = "https://pickler.fun/api/v1";
const EXPECTED = { address: account.address, chainId: 10143, domain: "pickler.fun" };

/** El mensaje tal como lo arma la API (viem `createSiweMessage` sobre los campos que decide core). */
function message(over: Partial<{ address: `0x${string}`; chainId: number; domain: string; statement: string }> = {}) {
  const domain = over.domain ?? "pickler.fun";
  return createSiweMessage({
    version: "1",
    domain,
    uri: `https://${domain}`,
    address: over.address ?? account.address,
    chainId: over.chainId ?? 10143,
    nonce: "a1b2c3d4e5f6a1b2c3d4e5f6",
    issuedAt: new Date(1_790_000_000_000),
    statement: over.statement ?? SIGN_IN_STATEMENT,
  });
}

describe("the deadline covers the body, not only the headers", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /** Un servidor que entrega los headers y nunca el body; el body sólo se rinde cuando la señal aborta. */
  const stalledBody: DoFetch = async (_url, init) => {
    const signal = init.signal!;
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort);
      }),
    } as unknown as Response;
  };

  test("headers followed by a body that never arrives end as a timeout, not as a request that hangs", async () => {
    const pending = call(`${BASE}/profile`, { method: "GET" }, stalledBody);
    const outcome = pending.then(() => "resolved", (e: unknown) => e);
    await jest.advanceTimersByTimeAsync(15_000);
    const result = await outcome;
    expect(result).toBeInstanceOf(IdentityError);
    expect(result).toMatchObject({ status: 0, code: "timeout" });
  });

  test("a body that arrives in time is read as before", async () => {
    const quick: DoFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { handle: "nightowl" } }) }) as Response;
    await expect(call(`${BASE}/profile`, { method: "GET" }, quick)).resolves.toEqual({ handle: "nightowl" });
  });
});

describe("the username screen waits for the foreground to be quiet", () => {
  test("a treasury operation, a read in flight or Perpl's onboarding each keep it closed", () => {
    expect(appQuiet({ treasuryBusy: false, readPending: false, perplOnboarding: false })).toBe(true);
    expect(appQuiet({ treasuryBusy: true, readPending: false, perplOnboarding: false })).toBe(false);
    expect(appQuiet({ treasuryBusy: false, readPending: true, perplOnboarding: false })).toBe(false);
    expect(appQuiet({ treasuryBusy: false, readPending: false, perplOnboarding: true })).toBe(false);
  });

  test("Perpl's onboarding counts while it runs, not once it stopped on an error", () => {
    expect(perplOnboardingActive({ status: "onboarding" })).toBe(true);
    // Sin MON o con la tx rechazada, Perpl se queda en `onboarding` con `error` y nada corre: la pantalla sí puede salir.
    expect(perplOnboardingActive({ status: "onboarding", error: "You need test MON for gas." })).toBe(false);
    expect(perplOnboardingActive({ status: "ready" })).toBe(false);
    expect(perplOnboardingActive({ status: "none" })).toBe(false);
    expect(perplOnboardingActive({ status: "loading" })).toBe(false);
  });

  test("once shown it stays, whatever starts underneath; and it never shows for an account that is not known to lack a username", () => {
    expect(gateShows({ status: "none" }, false, false)).toBe(false);
    expect(gateShows({ status: "none" }, false, true)).toBe(true);
    expect(gateShows({ status: "none" }, true, false)).toBe(true);
    expect(gateShows({ status: "has", handle: "nightowl" }, true, true)).toBe(false);
    expect(gateShows({ status: "unreachable" }, false, true)).toBe(false);
  });
});

describe("nothing is signed that is not this wallet's sign-in message", () => {
  test("the sign-in message for this address, chain and domain passes", () => {
    expect(() => checkSignInMessage(message(), EXPECTED)).not.toThrow();
    // El host del estudio está dentro del límite de confianza del passkey (spec mobile-monorepo §2): se acepta.
    expect(() => checkSignInMessage(message({ domain: "app.pickler.fun" }), { ...EXPECTED, domain: "pickler.fun" })).not.toThrow();
    // Mayúsculas en la dirección no cambian la cuenta.
    expect(() => checkSignInMessage(message(), { ...EXPECTED, address: account.address.toLowerCase() })).not.toThrow();
  });

  test("the join message, another address, another chain, another site or a malformed string are all refused", () => {
    const refused = (m: string) => expect(() => checkSignInMessage(m, EXPECTED)).toThrow(IdentityError);
    refused(message({ statement: `Link wallet ${OTHER} to this wallet's Pickler account` }));
    refused(message({ address: OTHER }));
    refused(message({ chainId: 1 }));
    refused(message({ domain: "pickler.fun.evil.example" }));
    refused(message({ domain: "notpickler.fun" }));
    refused("pickler.fun wants you to sign in with your Ethereum account:\n0x1\n\nSign in to Pickler\n");
    refused("");
    try { checkSignInMessage(message({ address: OTHER }), EXPECTED); } catch (e) {
      expect(e).toMatchObject({ status: 0, code: "unexpected_message" });
      expect(describeIdentityError(e)).toMatch(/Nothing was signed/);
    }
  });

  test("signing in refuses the join message before the wallet signs it", async () => {
    let signed = 0;
    const join = message({ statement: `Link wallet ${OTHER} to this wallet's Pickler account` });
    const doFetch: DoFetch = async (url) => {
      if (url.endsWith("/nonce")) return { ok: true, status: 200, json: async () => ({ data: { nonce: "n1", message: join } }) } as Response;
      throw new Error("verify must not be reached");
    };
    await expect(
      signInWithWallet({ base: BASE, address: account.address, chainId: 10143, domain: "pickler.fun", sign: async (m) => { signed += 1; return account.signMessage({ message: m }); } }, doFetch),
    ).rejects.toMatchObject({ code: "unexpected_message" });
    expect(signed).toBe(0);
  });
});
