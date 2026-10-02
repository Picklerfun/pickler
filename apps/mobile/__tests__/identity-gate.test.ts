import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { IdentityApi } from "../src/hooks/useIdentity";
import { UsernameGate } from "../src/screens/username";

// La pantalla obligatoria, montada de verdad (sin simulador): que renderiza, que consulta el handle, que reclama el que
// se escribió y que sus dos salidas —vincular en la web y cerrar sesión— están.
jest.useFakeTimers();
// Los iconos son ESM que Jest no transforma aquí (las suites de la app son de lógica pura); para montar una pantalla basta
// con que cada icono sea un componente que no pinta nada.
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_t, name) => (name === "__esModule" ? true : () => null) }));

const ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function mount(over: Partial<IdentityApi> = {}) {
  const calls = { check: [] as string[], claim: [] as string[], recheck: 0, signOut: 0 };
  const identity: IdentityApi = {
    identity: { status: "none" },
    busy: false,
    error: null,
    check: async (handle) => { calls.check.push(handle); return true; },
    claim: async (handle) => { calls.claim.push(handle); },
    recheck: async () => { calls.recheck += 1; },
    ...over,
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(SafeAreaProvider, { initialMetrics: METRICS }, createElement(UsernameGate, { identity, address: ADDRESS, onSignOut: () => { calls.signOut += 1; } })));
  });
  // Los primitivos anidan vistas con el mismo label: basta la primera que tenga onPress o onChangeText.
  const labelled = (label: string): ReactTestInstance => tree.root.findAll((n) => n.props.accessibilityLabel === label && (typeof n.props.onPress === "function" || typeof n.props.onChangeText === "function"))[0]!;
  const text = () => JSON.stringify(tree.toJSON());
  return { tree, calls, labelled, text };
}

test("it asks for the username, in the web's words, and names the connected wallet", () => {
  const { text } = mount();
  expect(text()).toContain("PICK YOUR USERNAME.");
  expect(text()).toContain("PICK ONE · 3–15");
  expect(text()).toContain("Claim it");
  expect(text()).toContain("Link this wallet to it");
  expect(text()).toContain("PASSKEY WALLET");
});

test("typing a handle checks it once it settles, and claiming sends what was typed", async () => {
  const { calls, labelled, text } = mount();
  act(() => { labelled("username-input").props.onChangeText("NightOwl"); });
  expect(text()).toContain("CHECKING…");
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(calls.check).toEqual(["nightowl"]);
  expect(text()).toContain("AVAILABLE");
  act(() => { labelled("username-claim").props.onPress(); });
  expect(calls.claim).toEqual(["NightOwl"]); // la normalización es del hook: aquí viaja lo escrito
});

test("a handle that is taken or malformed cannot be claimed", async () => {
  const { labelled, text } = mount({ check: async () => false });
  act(() => { labelled("username-input").props.onChangeText("nightowl"); });
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(text()).toContain("@NIGHTOWL IS TAKEN");
  expect(labelled("username-claim").props.disabled ?? labelled("username-claim").props.accessibilityState?.disabled).toBeTruthy();
});

test("the other way out says where linking happens, and checks again on request", () => {
  const { calls, labelled, text } = mount();
  act(() => { labelled("username-link").props.onPress(); });
  expect(text()).toContain("LINK TO YOUR ACCOUNT.");
  expect(text()).toContain("pickler.fun");
  act(() => { labelled("username-recheck").props.onPress(); });
  expect(calls.recheck).toBe(1);
  act(() => { labelled("username-back").props.onPress(); });
  expect(text()).toContain("PICK YOUR USERNAME.");
});

test("signing out is always there, and what failed is said", () => {
  const { calls, labelled, text } = mount({ error: "Couldn't reach Pickler. Check your connection and try again." });
  expect(text()).toContain("Couldn't reach Pickler");
  act(() => { labelled("username-sign-out").props.onPress(); });
  expect(calls.signOut).toBe(1);
});
