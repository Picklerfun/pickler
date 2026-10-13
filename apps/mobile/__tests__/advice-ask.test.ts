import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createElement } from "react";
import { AppState } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { hexToBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AccountState } from "../src/account";
import type { StudioAgent } from "../src/advice/types";
import { encodePayment, typedData, buildAuthorization, parsePaymentRequired } from "../src/advice/x402";
import { type AdviceAsk, newIdempotencyKey, useAdviceAsk } from "../src/hooks/useAdviceAsk";
import { WalletLockedError } from "../src/identity/api";

// The paid Ask as a hook, against a product API of make-believe (authedFetch) and a real local key: what is sent, with
// which key, when Face ID is asked for, and that nothing is ever signed twice for one Ask.

type G = { __studio: boolean; __splitter: string | null };
const g = globalThis as unknown as G;
g.__studio = true;
g.__splitter = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
jest.mock("../src/config/advice", () => ({
  get ADVICE_SPLITTER() { return (globalThis as unknown as G).__splitter; },
  studioAgentsEnabled: () => (globalThis as unknown as G).__studio,
}));
jest.mock("../src/wallet/wallet", () => ({
  unlockStoredWallet: jest.fn(),
  // As on the device: a cancelled Face ID prompt has no words.
  describeError: (e: unknown) => (e instanceof Error && /cancel/i.test(e.message) ? "" : e instanceof Error ? e.message : String(e)),
}));
const { unlockStoredWallet } = jest.requireMock("../src/wallet/wallet") as { unlockStoredWallet: jest.Mock };

jest.useFakeTimers();

// Anvil's first key: a test key, never funded anywhere real.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SPLITTER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PAYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TX = `0x${"ab".repeat(32)}`;
const SIG65 = /^0x[0-9a-fA-F]{130}$/; // core's decodePaymentHeader
const AGENT: StudioAgent = { id: "agent-1", name: "Mira", handle: "mira", accent: "#c6f432", venue: "perps", price: { micro: 1_500_000n, text: "1.5" } };

const makeWallet = () => {
  const account = privateKeyToAccount(KEY);
  jest.spyOn(account, "signTypedData");
  return { address: account.address, credentialId: "cred", session: { end() {} }, account };
};
type TestWallet = ReturnType<typeof makeWallet>;

// ── The API ──────────────────────────────────────────────────────────────────────────────────────────────────────────
type Sent = { method: string; path: string; key: string | null; payment: string | null; opened: unknown };
type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
/** An answer, or one that arrives `after` ms later (fake timers). */
type Reply = Answer | { after: number; reply: Answer };
let sent: Sent[] = [];
let posts: Reply[] = [];
let gets: Reply[] = [];
let lockedUntilOpened = false;

const reply = async (r: Reply): Promise<Response> => {
  if (!(r instanceof Error) && "after" in r) {
    await new Promise((resolve) => setTimeout(resolve, r.after));
    return reply(r.reply);
  }
  if (r instanceof Error) throw r;
  return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: new Headers(r.headers ?? {}), json: async () => r.body } as unknown as Response;
};
const authedFetch = jest.fn(async (path: string, init: RequestInit = {}, opened?: unknown) => {
  if (lockedUntilOpened && opened === undefined) throw new WalletLockedError();
  const h = new Headers(init.headers);
  sent.push({ method: init.method ?? "GET", path, key: h.get("Idempotency-Key"), payment: h.get("X-PAYMENT"), opened });
  return reply(((init.method ?? "GET") === "POST" ? posts.shift() : gets.shift()) ?? { status: 200, body: { data: job("running") } });
});
const postsSent = () => sent.filter((s) => s.method === "POST");
const paid = () => sent.filter((s) => s.payment !== null);

const accepts = {
  scheme: "exact", network: "monad-testnet", maxAmountRequired: "1500000",
  resource: "https://pickler.fun/api/v1/agent-advice/agents/agent-1/recommendations", description: "", mimeType: "application/json",
  payTo: SPLITTER, maxTimeoutSeconds: 300, asset: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  extra: {
    name: "Agora Dollar", version: "1", chainId: 10143, primaryType: "ReceiveWithAuthorization", payee: PAYEE,
    creatorBps: 6500, protocolBps: 3500, nonceDerivation: "keccak256(abi.encode(payee,salt))",
  },
};
const r402 = (error = "X-PAYMENT header is required", over: Record<string, unknown> = {}): Answer => ({ status: 402, body: { x402Version: 1, error, accepts: [{ ...accepts, ...over }] } });
const settlementHeader = btoa(JSON.stringify({ success: true, transaction: TX, network: "monad-testnet", payer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }));
const r202 = (withSettlement = true): Answer => ({
  status: 202,
  body: { data: { id: "job-1", status: "queued", statusUrl: "/v1/agent-advice/recommendations/job-1" } },
  headers: withSettlement ? { "X-PAYMENT-RESPONSE": settlementHeader } : {},
});
const RESULT = {
  version: 1, symbol: "BTC", network: "testnet", horizonHours: 24, orientation: "long", summary: "Up.", reasons: ["r"], risks: ["k"],
  limitations: ["l"], sources: [], generatedAt: "2026-10-12T10:00:00.000Z", dataAsOf: "2026-10-12T09:59:00.000Z",
};
function job(status: "queued" | "running" | "completed" | "failed", error: string | null = null) {
  return {
    id: "job-1", agentId: "agent-1", symbol: "BTC", status, createdAt: "2026-10-12T10:00:00.000Z", startedAt: null,
    finishedAt: status === "completed" || status === "failed" ? "2026-10-12T10:01:00.000Z" : null,
    result: status === "completed" ? RESULT : null, error,
  };
}
const rGet = (status: "queued" | "running" | "completed" | "failed", error: string | null = null): Answer => ({ status: 200, body: { data: job(status, error) } });

// ── The hook ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let latest!: AdviceAsk;
function Probe({ account }: { account: AccountState }) {
  latest = useAdviceAsk(account, () => {}, authedFetch as never);
  return null;
}
const settle = () => act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
const tick = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); await settle(); };
let tree: ReactTestRenderer | undefined;
async function mount(account: AccountState) {
  act(() => { tree = create(createElement(Probe, { account })); });
  await settle();
}
async function switchTo(account: AccountState) {
  act(() => { tree!.update(createElement(Probe, { account })); });
  await settle();
}
/** Starts a step without waiting for it: its answer arrives on a later tick. */
function start(fn: () => Promise<void>): Promise<void> {
  let p!: Promise<void>;
  act(() => { p = fn(); });
  return p;
}
const unlocked = (w: TestWallet): AccountState => ({ status: "unlocked", wallet: w as never });
const locked = (w: TestWallet): AccountState => ({ status: "locked", address: w.address as never, credentialId: "cred" });
const run = async (fn: () => Promise<void>) => { await act(async () => { await fn(); }); await settle(); };

let wallet: TestWallet;
beforeEach(() => {
  sent = [];
  posts = [];
  gets = [];
  lockedUntilOpened = false;
  g.__studio = true;
  g.__splitter = SPLITTER;
  jest.clearAllMocks();
  wallet = makeWallet();
});
afterEach(() => {
  act(() => { tree?.unmount(); });
  tree = undefined;
});

async function toConfirming(account: AccountState = unlocked(wallet)) {
  await mount(account);
  posts.push(r402());
  await run(() => latest.ask(AGENT, "BTC"));
  expect(latest.state.kind).toBe("confirming");
}

describe("the happy path", () => {
  test("quote, confirm, pay with the same key, wait, done", async () => {
    await toConfirming();
    expect(latest.state).toEqual({
      kind: "confirming",
      quote: { agent: AGENT, symbol: "BTC", total: 1_500_000n, creator: 975_000n, protocol: 525_000n, recipient: PAYEE },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/agent-advice/agents/agent-1/recommendations", payment: null });
    expect(wallet.account.signTypedData).not.toHaveBeenCalled();

    posts.push(r202());
    await run(() => latest.confirm());

    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
    const [quote, pay] = postsSent();
    expect(pay!.key).toBe(quote!.key);
    expect(pay!.payment).not.toBeNull();
    expect(latest.state).toMatchObject({ kind: "waiting", jobId: "job-1", settlement: { transaction: TX } });

    gets.push(rGet("running"), rGet("completed"));
    await tick(3_000);
    expect(latest.state.kind).toBe("waiting");
    await tick(3_000);
    expect(latest.state).toMatchObject({ kind: "done", recommendation: { id: "job-1", status: "completed" }, settlement: { transaction: TX } });
    expect(sent.filter((s) => s.method === "GET").every((s) => s.path === "/agent-advice/recommendations/job-1")).toBe(true);
  });

  test("the X-PAYMENT carries a 65-byte signature by the wallet over the app's own typed data", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());

    const header = JSON.parse(atob(paid()[0]!.payment!));
    const { signature, authorization: a } = header.payload;
    expect(signature).toMatch(SIG65);
    expect(a).toMatchObject({ from: wallet.address.toLowerCase(), to: SPLITTER.toLowerCase(), value: "1500000", validAfter: "0" });
    const recovered = await recoverTypedDataAddress({
      ...typedData({ from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce, salt: a.salt }),
      signature,
    });
    expect(recovered).toBe(wallet.address);
  });

  test("the flow names its agent and symbol while it lives, and nothing once it is left", async () => {
    await mount(unlocked(wallet));
    expect(latest.flow).toBeNull();
    posts.push(r402());
    await run(() => latest.ask(AGENT, "ETH"));
    expect(latest.flow).toEqual({ agent: AGENT, symbol: "ETH" });
    await run(async () => latest.reset());
    expect(latest.flow).toBeNull();
  });

  test("each Ask from idle gets a new Idempotency-Key", async () => {
    await toConfirming();
    // From the confirmation straight to a new Ask, and again after a reset: each one its own key.
    posts.push(r402());
    await run(() => latest.ask(AGENT, "ETH"));
    act(() => { latest.reset(); });
    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    const [first, second, third] = postsSent();
    expect(new Set([first!.key, second!.key, third!.key]).size).toBe(3);
    expect(first!.key).toBeTruthy();
    expect(second!.key).toBeTruthy();
    expect(second!.key).not.toBe(first!.key);
  });

  test("a new key is a UUID or 16 random bytes", () => {
    expect(newIdempotencyKey()).toMatch(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("before anything is signed", () => {
  test("with Studio agents off the hook refuses to start and sends nothing", async () => {
    g.__studio = false;
    await mount(unlocked(wallet));
    expect(latest.state.kind).toBe("off");
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state.kind).toBe("off");
    expect(sent).toHaveLength(0);
  });

  test("a 402 to another payTo is untrusted: no signature, no second request", async () => {
    await mount(unlocked(wallet));
    // A well-formed address that is not the app's splitter (and not the payee).
    posts.push(r402(undefined, { payTo: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" }));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "untrusted" });
    await run(() => latest.confirm());
    expect(wallet.account.signTypedData).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  test("a different price is shown and asked again; it is never signed without a confirmation", async () => {
    await mount(unlocked(wallet));
    posts.push(r402(undefined, { maxAmountRequired: "2000000" }));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "price_changed", shown: 1_500_000n, price: 2_000_000n });
    await run(() => latest.confirm());
    expect(wallet.account.signTypedData).not.toHaveBeenCalled();

    posts.push(r402(undefined, { maxAmountRequired: "2000000" }));
    await run(() => latest.acceptPrice());
    expect(latest.state).toMatchObject({ kind: "confirming", quote: { total: 2_000_000n } });
    expect(wallet.account.signTypedData).not.toHaveBeenCalled();
    expect(paid()).toHaveLength(0);
  });

  test("Face ID cancelled on the confirmation returns to idle with nothing sent", async () => {
    await mount(locked(wallet));
    // The quote went out with the wallet open (this Ask's own unlock), then it was locked again before paying.
    unlockStoredWallet.mockResolvedValueOnce(wallet);
    lockedUntilOpened = true;
    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state.kind).toBe("confirming");

    unlockStoredWallet.mockRejectedValueOnce(new Error("User canceled the operation."));
    await run(() => latest.confirm());

    expect(latest.state).toEqual({ kind: "idle" });
    expect(wallet.account.signTypedData).not.toHaveBeenCalled();
    expect(paid()).toHaveLength(0);
    expect(postsSent()).toHaveLength(1);
  });

  test("a locked wallet on the quote opens with Face ID and retries once with that wallet", async () => {
    await mount(locked(wallet));
    lockedUntilOpened = true;
    unlockStoredWallet.mockResolvedValueOnce(wallet);
    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    expect(unlockStoredWallet).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.opened).toBe(wallet);
    expect(latest.state.kind).toBe("confirming");
  });

  test("Face ID cancelled on the quote returns to idle with nothing sent", async () => {
    await mount(locked(wallet));
    lockedUntilOpened = true;
    unlockStoredWallet.mockRejectedValueOnce(new Error("User canceled the operation."));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "idle" });
    expect(sent).toHaveLength(0);
  });

  test("no network is offline with a retry; an offline sign-in too; any other sign-in failure is its own state", async () => {
    await mount(unlocked(wallet));
    posts.push(new TypeError("Network request failed"));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "offline", paid: false });
    posts.push(r402());
    await run(() => latest.retry());
    expect(latest.state.kind).toBe("confirming");
    const [first, second] = postsSent();
    expect(second!.key).toBe(first!.key);

    const { IdentityError } = jest.requireActual("../src/identity/api") as typeof import("../src/identity/api");
    posts.push(new IdentityError(0, "network"));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "offline", paid: false });
    posts.push(new IdentityError(401, "wrong_domain"));
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state).toEqual({ kind: "signin_error", code: "wrong_domain" });
  });

  test("backgrounded on the confirmation, the screen comes back idle", async () => {
    let listener: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_t: string, fn: (s: string) => void) => { listener = fn; return { remove() {} }; }) as never);
    await toConfirming();
    act(() => { listener!("background"); });
    await settle();
    expect(latest.state).toEqual({ kind: "idle" });
    await run(() => latest.confirm());
    expect(paid()).toHaveLength(0);
  });
});

describe("after signing", () => {
  test("settlement_failed is being checked: no automatic re-pay, and checking again never sends a payment", async () => {
    await toConfirming();
    posts.push(r402("settlement_failed"));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });
    expect(paid()).toHaveLength(1);

    await tick(60_000);
    await run(() => latest.confirm());
    await run(() => latest.retry());
    expect(paid()).toHaveLength(1);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);

    // Still pending server-side: the replay answers invalid_payment; the app keeps saying it is being checked.
    posts.push(r402("invalid_payment"));
    await run(() => latest.checkAgain());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });
    // The row was freed: a bare 402. Still never signed again for this Ask.
    posts.push(r402());
    await run(() => latest.checkAgain());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });
    expect(paid()).toHaveLength(1);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);

    // It landed: the replay returns the job.
    posts.push(r202(false));
    await run(() => latest.checkAgain());
    expect(latest.state).toMatchObject({ kind: "waiting", jobId: "job-1" });
    const keys = new Set(postsSent().map((s) => s.key));
    expect(keys.size).toBe(1);
  });

  test.each(["invalid_payment", "wrong_amount", "expired"])("%s is refused with its reason and nothing charged", async (error) => {
    await toConfirming();
    posts.push(r402(error));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "refused", error, nothingCharged: true, faucet: false });
  });

  test("insufficient_funds is refused with the Get test AUSD link", async () => {
    await toConfirming();
    posts.push(r402("insufficient_funds"));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "refused", error: "insufficient_funds", nothingCharged: true, faucet: true });
  });

  test("an answer lost after paying is retried with the same signed header, never a new signature", async () => {
    await toConfirming();
    posts.push(new TypeError("Network request failed"));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "offline", paid: true });

    // The first one did reach the server and is pending: the replay's invalid_payment is not "nothing charged".
    posts.push(r402("invalid_payment"));
    await run(() => latest.retry());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });
    const [first, second] = paid();
    expect(second!.payment).toBe(first!.payment);
    expect(second!.key).toBe(first!.key);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("busy after the payment settled: retry enqueues with the same key and no payment", async () => {
    await toConfirming();
    posts.push({ status: 429, body: { error: "ADVICE_BUSY" } });
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "busy", retrying: false });
    posts.push(r202(false));
    await run(() => latest.retry());
    expect(latest.state.kind).toBe("waiting");
    const last = postsSent().at(-1)!;
    expect(last.payment).toBeNull();
    expect(last.key).toBe(postsSent()[0]!.key);
    expect(paid()).toHaveLength(1);
  });
});

describe("waiting for the job", () => {
  test("a job that failed is failed, with the refund_owed note", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    gets.push(rGet("failed", "ANALYSIS_FAILED"));
    await tick(3_000);
    expect(latest.state).toEqual({ kind: "failed", error: "ANALYSIS_FAILED", refundOwed: true, settlement: { transaction: TX, payer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" } });
  });

  test("4 min without an answer is a timeout; refresh polls the same job and never pays again", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    for (let i = 0; i < 80; i += 1) await tick(3_000);
    expect(latest.state).toMatchObject({ kind: "timeout", jobId: "job-1" });
    const before = sent.length;
    await tick(30_000);
    expect(sent).toHaveLength(before); // a timeout stops polling

    gets.push(rGet("completed"));
    await run(() => latest.refresh());
    expect(latest.state).toMatchObject({ kind: "done", recommendation: { id: "job-1" } });
    const after = sent.slice(before);
    expect(after).toEqual([expect.objectContaining({ method: "GET", path: "/agent-advice/recommendations/job-1" })]);
    expect(postsSent()).toHaveLength(2);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("refresh of a job still running keeps waiting", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    for (let i = 0; i < 80; i += 1) await tick(3_000);
    expect(latest.state.kind).toBe("timeout");
    gets.push(rGet("running"), rGet("completed"));
    await run(() => latest.refresh());
    expect(latest.state.kind).toBe("waiting");
    await tick(3_000);
    expect(latest.state.kind).toBe("done");
  });
});

describe("the Mera account signs as an EOA", () => {
  test("toViemAccount over a local key gives a 65-byte r||s||v signature that core's pattern accepts", async () => {
    const account = toViemAccount(createSecp256k1SigningSession({ privateKey: hexToBytes(KEY) }));
    const terms = parsePaymentRequired({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [accepts] }).terms!;
    const authorization = buildAuthorization({ from: account.address, terms, now: 1_760_000_000_000, salt: `0x${"00".repeat(31)}01` });

    const signature = await account.signTypedData(typedData(authorization));

    expect(signature).toMatch(SIG65);
    expect([27, 28]).toContain(parseInt(signature.slice(-2), 16));
    expect(await recoverTypedDataAddress({ ...typedData(authorization), signature })).toBe(account.address);
    expect(JSON.parse(atob(encodePayment(authorization, signature))).payload.signature).toMatch(SIG65);
  });
});

describe("after a payment went out (fix round 1)", () => {
  const otherWallet = () => {
    const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    jest.spyOn(account, "signTypedData");
    return { address: account.address, credentialId: "cred2", session: { end() {} }, account };
  };

  test("the paid POST has 60 s: an answer at 20 s is the job, not offline (Ruling A3)", async () => {
    await toConfirming();
    posts.push({ after: 20_000, reply: r202() });
    const paying = start(() => latest.confirm());
    await settle();
    expect(latest.state.kind).toBe("paying");

    await tick(20_000);
    await act(async () => { await paying; });

    expect(latest.state).toMatchObject({ kind: "waiting", jobId: "job-1" });
    expect(paid()).toHaveLength(1);
  });

  test("the paid POST still gives up at 60 s, as offline with a payment", async () => {
    await toConfirming();
    posts.push({ after: 61_000, reply: r202() });
    const paying = start(() => latest.confirm());
    await settle();
    await tick(61_000);
    await act(async () => { await paying; });
    expect(latest.state).toEqual({ kind: "offline", paid: true });
  });

  test("a new Ask from offline with a payment sends nothing and signs nothing", async () => {
    await toConfirming();
    posts.push(new TypeError("Network request failed"));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "offline", paid: true });
    const before = sent.length;

    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    await run(() => latest.confirm());
    act(() => { latest.reset(); });
    await run(() => latest.abandon());

    expect(latest.state).toEqual({ kind: "offline", paid: true });
    expect(sent).toHaveLength(before);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("reset or a new Ask while a paid job is waiting keeps the job", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    expect(latest.state.kind).toBe("waiting");

    act(() => { latest.reset(); });
    await run(() => latest.ask(AGENT, "ETH"));
    expect(latest.state).toMatchObject({ kind: "waiting", jobId: "job-1" });
    expect(postsSent()).toHaveLength(2);

    gets.push(rGet("completed"));
    await tick(3_000);
    expect(latest.state.kind).toBe("done");

    // Done: a new Ask is free to start.
    posts.push(r402());
    await run(() => latest.ask(AGENT, "ETH"));
    expect(latest.state.kind).toBe("confirming");
  });

  test("reset while the paid POST is in flight keeps the flow", async () => {
    await toConfirming();
    posts.push({ after: 5_000, reply: r202() });
    const paying = start(() => latest.confirm());
    await settle();
    act(() => { latest.reset(); });
    await tick(5_000);
    await act(async () => { await paying; });
    expect(latest.state).toMatchObject({ kind: "waiting", jobId: "job-1" });
  });

  test.each([
    ["a paid 202 whose body is not the job", { status: 202, body: { nope: true } }],
    ["a paid answer the app has no state for", { status: 403, body: { error: "FORBIDDEN" } }],
    ["another attempt in flight", { status: 409, body: { error: "CONFLICT" } }],
    ["a server failure", { status: 503, body: { error: "ADVICE_UNAVAILABLE" } }],
  ])("%s is being checked, with checkAgain and no new signature", async (_name, answer) => {
    await toConfirming();
    posts.push(answer);
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });

    posts.push(r202(false));
    await run(() => latest.checkAgain());
    expect(latest.state.kind).toBe("waiting");
    expect(paid()).toHaveLength(1);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("a sign-in that fails on the paid POST is being checked, not a dead end", async () => {
    const { IdentityError } = jest.requireActual("../src/identity/api") as typeof import("../src/identity/api");
    await toConfirming();
    posts.push(new IdentityError(401, "nonce_invalid"));
    await run(() => latest.confirm());
    expect(latest.state).toEqual({ kind: "settlement_pending", checking: false });
  });

  test("abandon leaves only a settlement being checked, and the next Ask has a new key", async () => {
    await toConfirming();
    posts.push(r402("settlement_failed"));
    await run(() => latest.confirm());
    expect(latest.state.kind).toBe("settlement_pending");

    await run(() => latest.abandon());
    expect(latest.state).toEqual({ kind: "idle" });
    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state.kind).toBe("confirming");
    const keys = postsSent().map((x) => x.key);
    expect(keys.at(-1)).not.toBe(keys[0]);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("abandon from a timeout goes idle, polls no more, and the next Ask has a new key (Ruling A5)", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    for (let i = 0; i < 80; i += 1) await tick(3_000);
    expect(latest.state.kind).toBe("timeout");

    await run(() => latest.abandon());
    expect(latest.state).toEqual({ kind: "idle" });
    const before = sent.length;
    await tick(30_000);
    expect(sent).toHaveLength(before);

    posts.push(r402());
    await run(() => latest.ask(AGENT, "BTC"));
    expect(latest.state.kind).toBe("confirming");
    const keys = postsSent().map((x) => x.key);
    expect(keys.at(-1)).not.toBe(keys[0]);
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });

  test("abandon is ignored while the job is still being waited for", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    expect(latest.state.kind).toBe("waiting");
    await run(() => latest.abandon());
    expect(latest.state.kind).toBe("waiting");
  });

  test.each(["insufficient_funds", "expired"])("a resend after a lost answer refused with %s charged nothing", async (error) => {
    await toConfirming();
    posts.push(new TypeError("Network request failed"));
    await run(() => latest.confirm());
    posts.push(r402(error));
    await run(() => latest.retry());
    expect(latest.state).toEqual({ kind: "refused", error, nothingCharged: true, faucet: error === "insufficient_funds" });
  });

  test("another account: an unpaid Ask goes back to idle", async () => {
    await toConfirming();
    await switchTo(unlocked(otherWallet()));
    expect(latest.state).toEqual({ kind: "idle" });
  });

  test("another account: a paid job is dropped from view, polled no more, and nothing is signed for the new one", async () => {
    await toConfirming();
    posts.push(r202());
    await run(() => latest.confirm());
    expect(latest.state.kind).toBe("waiting");
    const other = otherWallet();

    await switchTo(unlocked(other));
    expect(latest.state).toEqual({ kind: "idle" });
    const before = sent.length;
    await tick(30_000);
    expect(sent).toHaveLength(before);
    expect(other.account.signTypedData).not.toHaveBeenCalled();
    expect(wallet.account.signTypedData).toHaveBeenCalledTimes(1);
  });
});
