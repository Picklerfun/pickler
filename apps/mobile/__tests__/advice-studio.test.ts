import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { privateKeyToAccount } from "viem/accounts";
import type { AccountState } from "../src/account";
import { type Studio, useStudio } from "../src/hooks/useStudio";
import { AdviceScreen } from "../src/screens/advice";

// The paid Ask lives above the screens (useStudio, called once by App.tsx): the advice screen, mounted for real here,
// only attaches to it. Leaving the screen mid-flow (back, another tab) and coming back must find the same Ask — the
// same job, still polled, nothing asked or signed again — and not an idle screen that would let the person pay twice.

jest.mock("../src/config/advice", () => ({
  ADVICE_SPLITTER: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  studioAgentsEnabled: () => true,
}));
jest.mock("../src/config/api", () => ({ API_URL: "https://api.test/v1" }));
jest.mock("../src/wallet/wallet", () => ({
  unlockStoredWallet: jest.fn(),
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const { unlockStoredWallet } = jest.requireMock("../src/wallet/wallet") as { unlockStoredWallet: jest.Mock };
// Icons only: lucide ships ESM that Jest does not transform here.
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_t, key) => (key === "__esModule" ? false : () => null) }));
// The page chrome reads the whole app context (seal, Perpl, safe area); the screen's body is what is under test.
jest.mock("../src/ui/Page", () => ({
  PageScroll: ({ children }: { children: unknown }) => children,
  FooterBar: ({ children }: { children: unknown }) => children,
}));

jest.useFakeTimers();

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil's first key, a test key
const SPLITTER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PAYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ROW = { id: "mira", name: "Mira", handle: "mira", accent: "#c6f432", venue: "perps", advicePrice: { asset: "AUSD", decimals: 6, amount: "1.5" } };

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Sent = { method: string; path: string; payment: string | null };
let sent: Sent[] = [];
/** An Error is a request that never got an answer (no network). */
let posts: (Reply | Error)[] = [];
let jobs: Reply[] = [];

const respond = (r: Reply): Response =>
  ({ status: r.status, ok: r.status >= 200 && r.status < 300, headers: new Headers(r.headers ?? {}), json: async () => r.body }) as unknown as Response;

const authedFetch = jest.fn(async (path: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  sent.push({ method, path, payment: new Headers(init.headers).get("X-PAYMENT") });
  if (method === "POST") {
    const next = posts.shift() ?? { status: 500 };
    if (next instanceof Error) throw next;
    return respond(next);
  }
  if (path.includes("?symbol=")) return respond({ status: 200, body: { data: { items: [], nextCursor: null } } });
  return respond(jobs.shift() ?? { status: 200, body: { data: job("running") } });
});

const r402 = (): Reply => ({
  status: 402,
  body: {
    x402Version: 1, error: "X-PAYMENT header is required",
    accepts: [{
      scheme: "exact", network: "monad-testnet", maxAmountRequired: "1500000", resource: "https://api.test/v1/agent-advice/agents/mira/recommendations",
      description: "", mimeType: "application/json", payTo: SPLITTER, maxTimeoutSeconds: 300, asset: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      extra: {
        name: "Agora Dollar", version: "1", chainId: 10143, primaryType: "ReceiveWithAuthorization", payee: PAYEE,
        creatorBps: 6500, protocolBps: 3500, nonceDerivation: "keccak256(abi.encode(payee,salt))",
      },
    }],
  },
});
const r202 = (): Reply => ({ status: 202, body: { data: { id: "job-1", status: "queued", statusUrl: "/v1/agent-advice/recommendations/job-1" } } });
function job(status: "running" | "completed") {
  return {
    id: "job-1", agentId: "mira", symbol: "BTC", status, createdAt: "2026-10-12T10:00:00.000Z", startedAt: null,
    finishedAt: status === "completed" ? "2026-10-12T10:01:00.000Z" : null, error: null,
    result: status === "completed" ? {
      version: 1, symbol: "BTC", network: "testnet", horizonHours: 24, orientation: "long", summary: "Funding is calm.",
      reasons: ["r"], risks: ["k"], limitations: ["l"], sources: [], generatedAt: "2026-10-12T10:01:00.000Z", dataAsOf: "2026-10-12T10:00:00.000Z",
    } : null,
  };
}

const account = privateKeyToAccount(KEY);
jest.spyOn(account, "signTypedData");
const unlocked: AccountState = { status: "unlocked", wallet: { address: account.address, credentialId: "cred", session: { end() {} }, account } as never };

let studio!: Studio;
function Host({ show, agentId = "mira" }: { show: boolean; agentId?: string }) {
  studio = useStudio(unlocked, () => {}, authedFetch as never, true);
  const ctx = { S: { marketTab: "trade", adviceAgentId: agentId }, studio, account: unlocked, nav: jest.fn(), identity: { authedFetch } };
  return show ? createElement(AdviceScreen, ctx as never) : null;
}

const settle = () => act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
const tick = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); await settle(); };
let tree: ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string): ReactTestInstance => tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0]!;
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); await settle(); };
const show = async (on: boolean, agentId = "mira") => { act(() => { tree.update(createElement(Host, { show: on, agentId })); }); await settle(); };
const OTHER = { ...ROW, id: "nope", name: "Basis Hunter", handle: "basis" };

async function paidAndWaiting() {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  posts.push(r402());
  await press("advice-ask");
  posts.push(r202());
  await press("advice-pay");
  expect(text()).toContain("ANALYZING · PAID");
}

beforeEach(() => {
  sent = [];
  posts = [];
  jobs = [];
  // Pay reads the passkey again (Face ID, Ruling A8): the same account, in a signing session of its own.
  unlockStoredWallet.mockImplementation(async () => ({ address: account.address, credentialId: "cred", session: { end() {} }, account }));
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => respond({ status: 200, body: [ROW] }));
});

test("leaving the advice screen mid-analysis and coming back finds the same paid Ask, never a new one", async () => {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  expect(text()).toContain("Ask · 1.50 AUSD");

  posts.push(r402());
  await press("advice-ask");
  expect(text()).toContain("Pay 1.50 AUSD");
  expect(text()).toContain("65% to @mira · 35% to Pickler");

  posts.push(r202());
  await press("advice-pay");
  expect(text()).toContain("ANALYZING · PAID");

  // Back out of the screen (it unmounts) while the job runs, and let a poll go by.
  await show(false);
  await tick(3_000);
  await show(true);

  expect(text()).toContain("ANALYZING · PAID");
  expect(text()).not.toContain("Ask · 1.50 AUSD");
  expect(sent.filter((s) => s.method === "POST")).toHaveLength(2);
  expect(sent.filter((s) => s.payment !== null)).toHaveLength(1);
  expect(account.signTypedData).toHaveBeenCalledTimes(1);

  // The same job is still polled and its result lands on the screen that came back.
  jobs.push({ status: 200, body: { data: job("completed") } });
  await tick(3_000);
  expect(text()).toContain("Funding is calm.");
  expect(text()).toContain("LONG");
  act(() => { tree.unmount(); });
});

describe("the Studio agents section of the Agents tab", () => {
  const { AgentsScreen } = require("../src/screens/agents") as typeof import("../src/screens/agents");
  const agent = { id: "mira", name: "Mira", handle: "mira", accent: "#c6f432", venue: "perps", price: { micro: 1_500_000n, text: "1.5" } };
  const render = (studioAgents: boolean) => {
    const ctx = {
      S: { marketTab: "trade" }, reads: { agents: [], agentsError: "" }, perpl: { context: null }, requireAccount: jest.fn(),
      identity: { studioAgents }, studio: { agents: [agent], agentsError: null, refresh: jest.fn() },
    };
    let t!: ReactTestRenderer;
    act(() => { t = create(createElement(AgentsScreen, ctx as never)); });
    const json = JSON.stringify(t.toJSON());
    const ask = t.root.findAll((n) => n.props.accessibilityLabel === "studio-ask-mira" && typeof n.props.onPress === "function")[0];
    if (ask) act(() => { ask.props.onPress(); });
    act(() => { t.unmount(); });
    return { json, requireAccount: ctx.requireAccount };
  };

  test("is hidden unless identity.studioAgents; the credit list is there either way", () => {
    const off = render(false);
    expect(off.json).not.toContain("STUDIO AGENTS");
    expect(off.json).toContain("No agents yet.");
  });

  test("lists each agent with its AUSD price and opens the gated advice screen", () => {
    const on = render(true);
    expect(on.json).toContain("STUDIO AGENTS");
    expect(on.json).toContain("Ask · 1.50 AUSD");
    expect(on.requireAccount).toHaveBeenCalledWith("advice", { adviceAgentId: "mira" });
  });
});

test("an agent that leaves the list keeps its paid Ask on view, with the wait and the payment", async () => {
  await paidAndWaiting();
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => respond({ status: 200, body: [] }));
  await act(async () => { await studio.refresh(); });
  await settle();
  expect(studio.agents).toEqual([]);
  expect(text()).toContain("ANALYZING · PAID");
  expect(text()).not.toContain("isn't listed anymore");
  act(() => { tree.unmount(); });
});

test("another agent's screen asks to finish or leave the paid Ask, and offers no Ask of its own", async () => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => respond({ status: 200, body: [ROW, OTHER] }));
  await paidAndWaiting();
  await show(true, "nope");
  expect(text()).toContain("Finish or leave the analysis in progress");
  expect(text()).toContain("Open Mira");
  expect(button("advice-ask").props.disabled).toBe(true);
  act(() => { tree.unmount(); });
});

test("a paid Ask with no answer can be left, with the same warning as a payment being checked (final review M1)", async () => {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  posts.push(r402());
  await press("advice-ask");
  posts.push(new TypeError("Network request failed"));
  await press("advice-pay");
  expect(text()).toContain("NO ANSWER · PAYMENT SENT");
  const before = sent.length;

  await press("advice-leave");
  expect(text()).toContain("The first payment may still land and be charged.");
  await press("advice-leave-confirm");

  expect(text()).toContain("Ask · 1.50 AUSD");
  expect(sent).toHaveLength(before);
  act(() => { tree.unmount(); });
});

test("a 503 before the quote says the agent can't answer right now, and that nothing was paid (final review M2)", async () => {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  posts.push({ status: 503, body: { error: "ADVICE_UNAVAILABLE" } });
  await press("advice-ask");
  expect(text()).toContain("This agent can't answer right now");
  expect(text()).toContain("Nothing was paid. (ADVICE_UNAVAILABLE)");
  act(() => { tree.unmount(); });
});

test("a payment being checked covers one that landed but is not queued yet, and never says nothing was charged (M2)", async () => {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  posts.push(r402());
  await press("advice-ask");
  posts.push({ status: 503, body: { error: "ADVICE_COST_UNKNOWN" } });
  await press("advice-pay");
  expect(text()).toContain("PAYMENT BEING CHECKED");
  expect(text()).toContain("not queued yet");
  expect(text()).not.toMatch(/[Nn]othing (was|is) (charged|paid)\b(?! again)/);
  act(() => { tree.unmount(); });
});

test("the confirmation always says Face ID confirms the payment, with the wallet already open (Ruling A8)", async () => {
  act(() => { tree = create(createElement(Host, { show: true })); });
  await settle();
  posts.push(r402());
  await press("advice-ask");

  expect(text()).toContain("Face ID confirms this payment.");
  expect(button("advice-pay").props.icon).toBe("faceId");
  act(() => { tree.unmount(); });
});
