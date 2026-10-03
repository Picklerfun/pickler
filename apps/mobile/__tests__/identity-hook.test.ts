import { base64urlnopad, utf8 } from "@scure/base";
import { createSiweMessage } from "viem/siwe";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { AccountState } from "../src/account";
import { type IdentityApi, useIdentity } from "../src/hooks/useIdentity";

// El hook entero contra una API y un SecureStore de mentira: cuándo pregunta, cuándo retiene y cuándo no.

const store = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => (globalThis as unknown as { __store: Map<string, string> }).__store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void (globalThis as unknown as { __store: Map<string, string> }).__store.set(k, v),
  deleteItemAsync: async (k: string) => void (globalThis as unknown as { __store: Map<string, string> }).__store.delete(k),
}));
(globalThis as unknown as { __store: Map<string, string> }).__store = store;

jest.mock("../src/config/api", () => ({ API_URL: "https://pickler.test/api/v1" }));
// `config/rp` lee app.config.ts vía expo-constants, que no existe bajo Jest.
jest.mock("../src/config/rp", () => ({ RP_ID: "pickler.fun", RP_NAME: "Pickler" }));
jest.mock("../src/wallet/wallet", () => ({ unlockStoredWallet: jest.fn(), describeError: (e: unknown) => ((e as { code?: string } | null)?.code === "ERR_AUTHENTICATION" ? "" : e instanceof Error ? e.message : String(e)) }));
jest.mock("../src/identity/api", () => ({
  ...jest.requireActual("../src/identity/api"),
  fetchChallenge: jest.fn(),
  presentSignature: jest.fn(),
  fetchProfile: jest.fn(),
  createProfile: jest.fn(),
  handleAvailable: jest.fn(),
}));

const api = jest.requireMock("../src/identity/api") as { [K in "fetchChallenge" | "presentSignature" | "fetchProfile" | "createProfile" | "handleAvailable"]: jest.Mock };
const { IdentityError } = jest.requireActual("../src/identity/api") as typeof import("../src/identity/api");
const { unlockStoredWallet } = jest.requireMock("../src/wallet/wallet") as { unlockStoredWallet: jest.Mock };

const A = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const B = "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF";
// Lo que la API contesta en /nonce: un SIWE de entrada para esa dirección. La sesión lo comprueba antes de firmar, así
// que un texto cualquiera ya no vale como mensaje.
const challenge = (address: string) =>
  createSiweMessage({ version: "1", domain: "pickler.fun", uri: "https://pickler.fun", address: address as `0x${string}`, chainId: 10143, nonce: "a1b2c3d4e5f6a1b2c3d4e5f6", issuedAt: new Date(1_790_000_000_000), statement: "Sign in to Pickler" });
const b64 = (o: unknown) => base64urlnopad.encode(utf8.decode(JSON.stringify(o)));
const token = (sub: string) => `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const wallet = (address: string) => ({ address, credentialId: "cred", session: { end() {} }, account: { signMessage: jest.fn(async () => "0xsig") } });
const unlocked = (address: string): AccountState => ({ status: "unlocked", wallet: wallet(address) as never });
const locked = (address: string): AccountState => ({ status: "locked", address: address as never, credentialId: "cred" });

let latest!: IdentityApi;
function Probe({ account }: { account: AccountState }) {
  latest = useIdentity(account, () => {});
  return null;
}
const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
async function mount(account: AccountState) {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(createElement(Probe, { account })); });
  await settle();
  return { to: async (next: AccountState) => { act(() => { tree.update(createElement(Probe, { account: next })); }); await settle(); } };
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  api.fetchChallenge.mockImplementation(async (_base: string, address: string) => challenge(address));
  api.presentSignature.mockImplementation(async () => ({ userId: "user-1", token: token("user-1") }));
});

test("without a wallet nothing is asked", async () => {
  await mount({ status: "none" });
  expect(latest.identity).toEqual({ status: "unknown" });
  expect(api.fetchChallenge).not.toHaveBeenCalled();
});

test("an unlocked wallet signs in by itself and an account without a username is held", async () => {
  api.fetchProfile.mockResolvedValue(null);
  const opened = wallet(A);
  await mount({ status: "unlocked", wallet: opened as never });
  expect(api.fetchChallenge).toHaveBeenCalledWith("https://pickler.test/api/v1", A, 10143, expect.anything());
  // Firma el mensaje del servidor con la wallet abierta: sin prompt.
  expect(opened.account.signMessage).toHaveBeenCalledWith({ message: challenge(A) });
  expect(latest.identity).toEqual({ status: "none" });
});

test("an account with a username is remembered, and the next start asks nobody", async () => {
  api.fetchProfile.mockResolvedValue({ handle: "nightowl" });
  await mount(unlocked(A));
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
  expect(store.get("pickler.identity.v1")).toBe(JSON.stringify({ address: A.toLowerCase(), handle: "nightowl", api: "https://pickler.test/api/v1" }));

  jest.clearAllMocks();
  await mount(locked(A)); // arranque en frío: bloqueada, sin Face ID y sin red
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
  expect(api.fetchChallenge).not.toHaveBeenCalled();
});

test("a locked wallet with nothing stored is not asked: that would be a Face ID prompt at start", async () => {
  await mount(locked(A));
  expect(latest.identity).toEqual({ status: "unknown" });
  expect(api.fetchChallenge).not.toHaveBeenCalled();
  expect(unlockStoredWallet).not.toHaveBeenCalled();
});

test("a message that is not this wallet's sign-in is never signed, and holds nobody", async () => {
  // La misma ruta de /nonce puede emitir el mensaje que deja entrar a otra wallet a la cuenta. Si llega, no se firma y
  // la cuenta queda como no alcanzable: nadie se queda fuera de sus fondos por ello.
  api.fetchChallenge.mockResolvedValue(createSiweMessage({ version: "1", domain: "pickler.fun", uri: "https://pickler.fun", address: A, chainId: 10143, nonce: "a1b2c3d4e5f6a1b2c3d4e5f6", issuedAt: new Date(1_790_000_000_000), statement: `Link wallet ${B} to this wallet's Pickler account` }));
  api.fetchProfile.mockResolvedValue(null);
  const opened = wallet(A);
  await mount({ status: "unlocked", wallet: opened as never });
  expect(opened.account.signMessage).not.toHaveBeenCalled();
  expect(api.presentSignature).not.toHaveBeenCalled();
  expect(latest.identity).toEqual({ status: "unreachable" });
});

test("an API that cannot be reached holds nobody", async () => {
  api.fetchChallenge.mockRejectedValue(new IdentityError(0, "network"));
  await mount(unlocked(A));
  expect(latest.identity).toEqual({ status: "unreachable" });

  api.fetchChallenge.mockResolvedValue(challenge(B));
  api.fetchProfile.mockRejectedValue(new IdentityError(500, "500"));
  await mount(unlocked(B));
  expect(latest.identity).toEqual({ status: "unreachable" });
});

test("claiming a username writes it with the session, remembers it and opens the app", async () => {
  api.fetchProfile.mockResolvedValue(null);
  api.createProfile.mockImplementation(async (_base: string, _token: string, handle: string) => ({ handle }));
  await mount(unlocked(A));
  await act(async () => { await latest.claim("  @NightOwl "); });
  expect(api.createProfile).toHaveBeenCalledWith("https://pickler.test/api/v1", expect.any(String), "nightowl");
  // La sesión de la entrada sirve: no se firma dos veces.
  expect(api.presentSignature).toHaveBeenCalledTimes(1);
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
  expect(store.get("pickler.identity.v1")).toContain("nightowl");
});

test("a username the server refuses says why and holds the screen", async () => {
  api.fetchProfile.mockResolvedValue(null);
  api.createProfile.mockRejectedValue(new IdentityError(409, "handle_taken", "That handle is taken"));
  await mount(unlocked(A));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.error).toBe("Someone already has that one.");
  expect(latest.identity).toEqual({ status: "none" });
  expect(latest.busy).toBe(false);
});

test("a claim whose answer was lost is found done: the account is read again before anything is said", async () => {
  api.fetchProfile.mockResolvedValueOnce(null); // al entrar: sin username
  api.createProfile.mockRejectedValue(new IdentityError(0, "timeout")); // el servidor lo creó; el «sí» no llegó
  api.fetchProfile.mockResolvedValue({ handle: "nightowl" });
  await mount(unlocked(A));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
  expect(latest.error).toBeNull();
  // Entra de nuevo antes de leer: la sesión anterior pudo ser de una cuenta que ya no existe.
  expect(api.presentSignature).toHaveBeenCalledTimes(2);
});

test("a wallet linked on the web meanwhile: claiming fails, and the account it opens now is what counts", async () => {
  api.fetchProfile.mockResolvedValueOnce(null);
  api.createProfile.mockRejectedValue(new IdentityError(500, "500")); // el token era de la cuenta que se borró
  api.fetchProfile.mockResolvedValue({ handle: "dayowl" });
  await mount(unlocked(A));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "has", handle: "dayowl" });
});

test("a failure that is not about the username lets go of the screen: nobody is kept from their funds", async () => {
  api.fetchProfile.mockResolvedValue(null);
  await mount(unlocked(A));
  expect(latest.identity).toEqual({ status: "none" });

  // El servidor falla al reclamar y la cuenta sigue sin username: no hay nada que la persona pueda escribir distinto.
  api.createProfile.mockRejectedValue(new IdentityError(503, "503"));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "unreachable" });

  // Y si ni siquiera se puede volver a preguntar, igual.
  await mount(unlocked(B));
  api.createProfile.mockRejectedValue(new IdentityError(0, "network"));
  api.fetchChallenge.mockRejectedValue(new IdentityError(0, "network"));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "unreachable" });
});

test("checking again that cannot reach the server lets go too, and the quiet check says nothing", async () => {
  api.fetchProfile.mockResolvedValue(null);
  await mount(unlocked(A));
  await act(async () => { await latest.recheck({ quiet: true }); });
  expect(latest.error).toBeNull();
  expect(latest.identity).toEqual({ status: "none" });

  // La comprobación silenciosa que falla no suelta nada: la red despertando al volver del navegador no es una salida.
  api.fetchProfile.mockRejectedValue(new IdentityError(0, "network"));
  await act(async () => { await latest.recheck({ quiet: true }); });
  expect(latest.identity).toEqual({ status: "none" });
  expect(latest.error).toBeNull();

  await act(async () => { await latest.recheck(); });
  expect(latest.identity).toEqual({ status: "unreachable" });
});

test("claiming with the wallet locked unlocks it, and a cancelled Face ID says nothing", async () => {
  api.fetchProfile.mockResolvedValue(null);
  api.createProfile.mockImplementation(async (_base: string, _token: string, handle: string) => ({ handle }));
  const view = await mount(unlocked(A));
  await view.to(locked(A));
  expect(latest.identity).toEqual({ status: "none" });

  unlockStoredWallet.mockRejectedValueOnce(Object.assign(new Error("User canceled the authentication"), { code: "ERR_AUTHENTICATION" }));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "none" });
  expect(api.createProfile).not.toHaveBeenCalled();

  unlockStoredWallet.mockResolvedValue(wallet(A));
  await act(async () => { await latest.claim("nightowl"); });
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
});

test("a token about to expire is not sent: the wallet signs in again", async () => {
  const expiring = `${b64({ alg: "HS256" })}.${b64({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 30 })}.sig`;
  api.presentSignature.mockImplementation(async () => ({ userId: "user-1", token: expiring }));
  api.fetchProfile.mockResolvedValue(null);
  api.createProfile.mockImplementation(async (_base: string, _token: string, handle: string) => ({ handle }));
  await mount(unlocked(A));
  await act(async () => { await latest.claim("nightowl"); });
  expect(api.presentSignature).toHaveBeenCalledTimes(2);
});

test("an answer that arrives after signing out says nothing about whoever is there now", async () => {
  let answer!: (profile: null) => void;
  api.fetchProfile.mockImplementation(() => new Promise((done) => { answer = done; }));
  const view = await mount(unlocked(A));
  expect(latest.identity).toEqual({ status: "checking" });
  await view.to({ status: "none" });
  await act(async () => { answer(null); });
  await settle();
  expect(latest.identity).toEqual({ status: "unknown" });
});

test("locking with the screen up keeps it up; another wallet starts from nothing", async () => {
  api.fetchProfile.mockResolvedValue(null);
  const view = await mount(unlocked(A));
  expect(latest.identity).toEqual({ status: "none" });

  await view.to(locked(A));
  expect(latest.identity).toEqual({ status: "none" });

  api.fetchProfile.mockResolvedValue({ handle: "dayowl" });
  await view.to(unlocked(B));
  expect(latest.identity).toEqual({ status: "has", handle: "dayowl" });

  await view.to({ status: "none" });
  expect(latest.identity).toEqual({ status: "unknown" });
});

test("checking again signs in afresh: the wallet may open another account since it was linked on the web", async () => {
  api.fetchProfile.mockResolvedValue(null);
  await mount(unlocked(A));
  expect(api.presentSignature).toHaveBeenCalledTimes(1);

  await act(async () => { await latest.recheck(); });
  expect(latest.error).toBe("This wallet's account still has no username.");
  expect(api.presentSignature).toHaveBeenCalledTimes(2);
  act(() => { latest.clearError(); });
  expect(latest.error).toBeNull();

  api.fetchProfile.mockResolvedValue({ handle: "nightowl" });
  await act(async () => { await latest.recheck(); });
  expect(latest.identity).toEqual({ status: "has", handle: "nightowl" });
  expect(latest.error).toBeNull();
});

test("availability is asked for the normalised handle", async () => {
  api.handleAvailable.mockResolvedValue(true);
  await mount(unlocked(A));
  expect(await latest.check(" @NightOwl")).toBe(true);
  expect(api.handleAvailable).toHaveBeenCalledWith("https://pickler.test/api/v1", "nightowl");
});
