// The paid Ask of a Studio agent (docs/specs/agent-advice-x402-v1.md §3.2–§3.3, fee split §4): quote (402), check the
// terms against the app's own constants, confirm, open the wallet (Face ID only if locked), sign the ReceiveWithAuthorization, pay
// with X-PAYMENT and poll the job. One Idempotency-Key per Ask from idle (Ruling A1), reused only by the paid retry of
// that Ask and by the replays that check on it. After a payment may have moved, nothing here ever signs again.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { type AccountState, accountAddress } from "../account";
import { AdviceApiError, type AdviceAnswer, acceptedFrom, getRecommendation, requestAdvice } from "../advice/api";
import { nextPoll, POLL_INTERVAL_MS, startPoll } from "../advice/poll";
import type { AdviceJobError, AdviceSymbol, Hex, PaymentError, PollState, Recommendation, StudioAgent, Terms } from "../advice/types";
import { buildAuthorization, checkTerms, decodeSettlement, encodePayment, parsePaymentRequired, randomSalt, shares, typedData } from "../advice/x402";
import { ADVICE_SPLITTER, studioAgentsEnabled } from "../config/advice";
import { type AuthedFetch, WalletLockedError } from "../identity/api";
import { describeError, type Wallet } from "../wallet/wallet";
import { useUnlock } from "./useUnlock";

/** What the confirmation shows, drawn from checked terms: never from the 402's own words. */
export type AskQuote = {
  agent: StudioAgent;
  symbol: AdviceSymbol;
  /** micro-AUSD, the price the agent row showed. */
  total: bigint;
  creator: bigint;
  protocol: bigint;
  /** The agent wallet that receives the creator's share. */
  recipient: Hex;
};

export type Settlement = { transaction: string; payer: string };

export type AdviceAskState =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "confirming"; quote: AskQuote }
  | { kind: "signing"; quote: AskQuote }
  | { kind: "paying"; quote: AskQuote }
  | { kind: "waiting"; jobId: string; since: number; settlement: Settlement | null }
  | { kind: "done"; recommendation: Recommendation; settlement: Settlement | null }
  /** The analysis failed after it was paid: the payment is marked refund_owed, not refunded automatically. */
  | { kind: "failed"; error: AdviceJobError; refundOwed: true; settlement: Settlement | null }
  /** 4 min without an answer: the job is still the server's; `refresh` reads it again and never pays. */
  | { kind: "timeout"; jobId: string; settlement: Settlement | null }
  /** The 402 named terms the app does not sign: nothing was signed. */
  | { kind: "untrusted" }
  /** The 402's amount is not the one the row showed: `acceptPrice` asks again at `price`. */
  | { kind: "price_changed"; shown: bigint; price: bigint }
  /** The server turned the payment down before settling it: nothing was charged. */
  | { kind: "refused"; error: PaymentError; nothingCharged: true; faucet: boolean }
  /** The payment may have moved and is being checked: never paid again; `checkAgain` replays the key. */
  | { kind: "settlement_pending"; checking: boolean }
  /** Paid, but the queue was full: `retry` enqueues the same payment, never a new one. */
  | { kind: "busy"; retrying: boolean }
  /** No answer from Pickler. `paid`: a payment was sent and its outcome is unknown; `retry` never signs again. */
  | { kind: "offline"; paid: boolean }
  | { kind: "signin_error"; code: string }
  | { kind: "error"; code: string; message: string | null };

export type AdviceAsk = {
  state: AdviceAskState;
  /**
   * Start an Ask: a new Idempotency-Key, a 402, the confirmation. Ignored while this Ask's payment is out and
   * unresolved (anything but done, failed or refused): the job id is kept and nothing is signed again. From
   * `settlement_pending` the person leaves with `abandon` first.
   */
  ask: (agent: StudioAgent, symbol: AdviceSymbol) => Promise<void>;
  /** From `price_changed`: ask again expecting the new price (nothing has been signed). */
  acceptPrice: () => Promise<void>;
  /** From `confirming`: open the wallet (prompting only if it is locked), sign, pay, wait. */
  confirm: () => Promise<void>;
  /** From `offline` or `busy`: the same step again, with the same key and never a new signature. */
  retry: () => Promise<void>;
  /** From `settlement_pending`: replay the key without a payment. */
  checkAgain: () => Promise<void>;
  /** From `timeout`: read the same job again, and keep waiting. */
  refresh: () => Promise<void>;
  /** Back to idle. Ignored, like `ask`, while this Ask's payment is out and unresolved. */
  reset: () => void;
  /** From `settlement_pending` only: leave the payment being checked (server-side) and go idle. Never signs. */
  abandon: () => Promise<void>;
};

type Flow = {
  key: string;
  agent: StudioAgent;
  symbol: AdviceSymbol;
  expected: bigint;
  terms: Terms | null;
  quote: AskQuote | null;
  /** The signed X-PAYMENT, kept only to resend the same authorization after an unknown outcome. */
  payment: string | null;
  /** A paid request went out and its answer never came: its replays read a refusal as "being checked". */
  uncertain: boolean;
  /** The server said the settlement is pending: the header is never sent again for this key. */
  pending: boolean;
  wallet: Wallet | undefined;
  jobId: string | null;
  settlement: Settlement | null;
  retry: (() => Promise<void>) | null;
  /** One step at a time: a double tap does not send twice. */
  running: boolean;
  /** A request that may carry or settle a payment is in flight: reset waits for it. */
  sending: boolean;
};

const OFF: AdviceAskState = { kind: "off" };
const IDLE: AdviceAskState = { kind: "idle" };
const PENDING: AdviceAskState = { kind: "settlement_pending", checking: false };
const CHECKING: AdviceAskState = { kind: "settlement_pending", checking: true };
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const OFFLINE_CODES = new Set(["network", "timeout", "signin_network", "signin_timeout"]);
/** Where a paid Ask is resolved: the job's answer, or a refusal that charged nothing. */
const RESOLVED = new Set<AdviceAskState["kind"]>(["done", "failed", "refused"]);

class Cancelled extends Error {}
class UnlockFailed extends Error {}

/** A fresh Idempotency-Key: a UUID, or 16 random bytes in hex where randomUUID is missing. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const errorCode = (a: AdviceAnswer): string =>
  a.json !== null && typeof a.json === "object" && typeof (a.json as { error?: unknown }).error === "string" ? (a.json as { error: string }).error : String(a.status);

/**
 * The paid Ask as a state machine (docs/mobile/superpowers/plans/2026-10-12-studio-agents-app.md, Task 3). `authedFetch`
 * is useIdentity's: it never unlocks, so a WalletLockedError opens the wallet here (Face ID) and retries once with it.
 */
export function useAdviceAsk(account: AccountState, onUnlock: (w: Wallet) => void, authedFetch: AuthedFetch): AdviceAsk {
  const [state, setState] = useState<AdviceAskState>(studioAgentsEnabled() ? IDLE : OFF);
  const unlock = useUnlock(account, onUnlock);
  const address = accountAddress(account);
  const unlockRef = useRef(unlock);
  unlockRef.current = unlock;
  const fetchRef = useRef(authedFetch);
  fetchRef.current = authedFetch;
  const stateRef = useRef(state);
  const flowRef = useRef<Flow | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const live = useCallback((f: Flow) => mounted.current && flowRef.current === f, []);

  /** The state of this Ask, if it is still the current one. */
  const put = useCallback((f: Flow | null, next: AdviceAskState) => {
    if (f !== null && !live(f)) return;
    stateRef.current = next;
    setState(next);
  }, [live]);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** The wallet, opened with Face ID if it is locked. Cancelled is not an error to show (describeError says ""). */
  const open = useCallback(async (): Promise<Wallet> => {
    try {
      return await unlockRef.current();
    } catch (e) {
      const words = describeError(e);
      throw words === "" ? new Cancelled() : new UnlockFailed(words);
    }
  }, []);

  /** An authed call for this Ask. With the wallet locked: open it, and send once more with the wallet in hand. */
  const authed = useCallback(async <T,>(f: Flow, run: (fetch: AuthedFetch) => Promise<T>): Promise<T> => {
    const fetch: AuthedFetch = (path, init) => fetchRef.current(path, init, f.wallet);
    try {
      return await run(fetch);
    } catch (e) {
      if (!(e instanceof WalletLockedError)) throw e;
      f.wallet = await open();
      if (!live(f)) throw new Cancelled();
      return run(fetch);
    }
  }, [live, open]);

  /** A step that failed. `cancelled` is where Face ID cancelled leads: idle before any payment, else where it was. */
  const fail = useCallback((f: Flow, e: unknown, cancelled: AdviceAskState) => {
    if (e instanceof Cancelled) {
      put(f, cancelled);
      if (cancelled.kind === "idle" && live(f)) flowRef.current = null;
      return;
    }
    const offline = e instanceof AdviceApiError && OFFLINE_CODES.has(e.code);
    if (offline) {
      put(f, { kind: "offline", paid: f.payment !== null });
      return;
    }
    if (f.payment !== null) {
      // After a payment went out no failure is a dead end: it is being checked, with checkAgain (no header).
      f.pending = true;
      put(f, PENDING);
      return;
    }
    if (e instanceof AdviceApiError) {
      if (e.code.startsWith("signin_")) put(f, { kind: "signin_error", code: e.code.slice("signin_".length) });
      else put(f, { kind: "error", code: e.code, message: null });
      return;
    }
    if (e instanceof UnlockFailed) {
      put(f, { kind: "error", code: "unlock", message: e.message });
      return;
    }
    if (e instanceof WalletLockedError) {
      put(f, { kind: "error", code: "locked", message: e.message });
      return;
    }
    put(f, { kind: "error", code: "unexpected", message: describeError(e) || null });
  }, [live, put]);

  /** One step at a time per Ask. */
  const step = useCallback(async (f: Flow, run: () => Promise<void>) => {
    if (f.running) return;
    f.running = true;
    try {
      await run();
    } finally {
      f.running = false;
    }
  }, []);

  const poll = useCallback((f: Flow, ps: PollState, delay: number) => {
    stopPolling();
    timer.current = setTimeout(() => {
      timer.current = null;
      void (async () => {
        let response: { ok: true; recommendation: Recommendation } | { ok: false };
        try {
          // Polling never prompts. It uses the wallet this Ask opened and the session's token in memory, so locking
          // the wallet does not stop it; a poll that fails (a 401 cannot sign in again on an ended session) only
          // counts toward the deadline.
          response = { ok: true, recommendation: await getRecommendation((path, init) => fetchRef.current(path, init, f.wallet), f.jobId!) };
        } catch {
          response = { ok: false };
        }
        if (!live(f)) return;
        const next = nextPoll(ps, response, Date.now());
        if (next.kind === "waiting") poll(f, next, POLL_INTERVAL_MS);
        else if (next.kind === "done") put(f, { kind: "done", recommendation: next.recommendation, settlement: f.settlement });
        else if (next.kind === "failed") put(f, { kind: "failed", error: next.error, refundOwed: true, settlement: f.settlement });
        else put(f, { kind: "timeout", jobId: f.jobId!, settlement: f.settlement });
      })();
    }, delay);
  }, [live, put, stopPolling]);

  /** A 202: the job exists (paid now, or a replay of one that was). Wait for it. */
  const accepted = useCallback((f: Flow, answer: AdviceAnswer) => {
    let job: { id: string };
    try {
      job = acceptedFrom(answer.json);
    } catch {
      if (f.payment !== null) {
        // A paid job the app could not read is not lost: checking again replays the key and returns it.
        f.pending = true;
        put(f, PENDING);
      } else {
        put(f, { kind: "error", code: "bad_response", message: null });
      }
      return;
    }
    f.jobId = job.id;
    f.settlement = decodeSettlement(answer.settlementHeader) ?? f.settlement;
    f.retry = null;
    const since = Date.now();
    put(f, { kind: "waiting", jobId: job.id, since, settlement: f.settlement });
    poll(f, startPoll(since), POLL_INTERVAL_MS);
  }, [poll, put]);

  /** The answer to a request after a payment was sent: from here on, nothing is signed again for this key. */
  const afterPayment = useCallback((f: Flow, answer: AdviceAnswer) => {
    if (answer.status === 202) {
      accepted(f, answer);
      return;
    }
    if (answer.status === 429) {
      // Settled, no job yet: the same key enqueues it (spec §3.3), with no payment header.
      put(f, { kind: "busy", retrying: false });
      return;
    }
    if (answer.status === 402) {
      const { error } = parsePaymentRequired(answer.json);
      // Only a refusal of the header itself says nothing was charged. A pending settlement, or a replay whose first
      // answer was lost (the server says invalid_payment over a pending row), is being checked.
      const overPendingRow = f.uncertain && (error === "invalid_payment" || error === "nonce_used");
      const checking = f.pending || error === "settlement_failed" || error === null || overPendingRow;
      if (checking) {
        f.pending = true;
        put(f, PENDING);
        return;
      }
      put(f, { kind: "refused", error: error!, nothingCharged: true, faucet: error === "insufficient_funds" });
      return;
    }
    // Anything else after the payment went out — another attempt in flight (409), a server failure, a status the app
    // has no state for — is being checked: never a dead end that only a new signature leaves.
    f.pending = true;
    put(f, PENDING);
  }, [accepted, put]);

  /**
   * A replay of the key with no payment: what the server has for it. Used by checkAgain and by busy's retry; `back` is
   * where Face ID cancelled returns.
   */
  const replay = useCallback(async (f: Flow, waiting: AdviceAskState, back: AdviceAskState) => {
    put(f, waiting);
    f.retry = () => step(f, () => replay(f, waiting, back));
    f.sending = true;
    let answer: AdviceAnswer;
    try {
      answer = await authed(f, (fetch) => requestAdvice(fetch, f.agent.id, f.symbol, f.key));
    } catch (e) {
      fail(f, e, back);
      return;
    } finally {
      f.sending = false;
    }
    if (!live(f)) return;
    if (answer.status === 402) {
      // Whatever the 402 says, this Ask is never signed again (Ruling A1): it stays being checked.
      f.pending = true;
      put(f, PENDING);
      return;
    }
    afterPayment(f, answer);
  }, [afterPayment, authed, fail, live, put, step]);

  /** The paid request, with the Ask's key. On a retry it resends the same signed header: one nonce, one charge. */
  const pay = useCallback(async (f: Flow) => {
    put(f, { kind: "paying", quote: f.quote! });
    f.retry = () => step(f, () => pay(f));
    f.sending = true;
    let answer: AdviceAnswer;
    try {
      answer = await authed(f, (fetch) => requestAdvice(fetch, f.agent.id, f.symbol, f.key, f.payment!));
    } catch (e) {
      f.uncertain = true;
      fail(f, e, { kind: "offline", paid: true });
      return;
    } finally {
      f.sending = false;
    }
    if (!live(f)) return;
    afterPayment(f, answer);
  }, [afterPayment, authed, fail, live, put, step]);

  /** POST without a payment: the 402 with the terms, checked here before anything is shown or signed. */
  const quote = useCallback(async (f: Flow) => {
    put(f, { kind: "quoting" });
    f.retry = () => step(f, () => quote(f));
    let answer: AdviceAnswer;
    try {
      answer = await authed(f, (fetch) => requestAdvice(fetch, f.agent.id, f.symbol, f.key));
    } catch (e) {
      fail(f, e, IDLE);
      return;
    }
    if (!live(f)) return;
    if (answer.status === 202) {
      accepted(f, answer);
      return;
    }
    if (answer.status !== 402) {
      put(f, { kind: "error", code: errorCode(answer), message: null });
      return;
    }
    const { terms, error } = parsePaymentRequired(answer.json);
    if (terms === null || ADVICE_SPLITTER === null) {
      put(f, { kind: "untrusted" });
      return;
    }
    const verdict = checkTerms(terms, f.expected, ADVICE_SPLITTER);
    if (verdict === "untrusted") {
      put(f, { kind: "untrusted" });
      return;
    }
    if (verdict === "price_changed") {
      f.terms = terms;
      put(f, { kind: "price_changed", shown: f.expected, price: terms.value });
      return;
    }
    if (error !== null) {
      // A refusal before this Ask sent any payment: nothing was signed, nothing charged.
      put(f, { kind: "refused", error, nothingCharged: true, faucet: error === "insufficient_funds" });
      return;
    }
    const split = shares(terms.value);
    f.terms = terms;
    f.quote = { agent: f.agent, symbol: f.symbol, total: terms.value, creator: split.creator, protocol: split.protocol, recipient: terms.payee };
    put(f, { kind: "confirming", quote: f.quote });
  }, [accepted, authed, fail, live, put, step]);

  /** This Ask's payment is out and not resolved: nothing may replace the flow or drop its job id. */
  const committed = useCallback((f: Flow | null) => {
    if (f === null) return false;
    if (f.sending) return true;
    return f.payment !== null && !RESOLVED.has(stateRef.current.kind);
  }, []);

  /** Forget the flow, whatever it holds. Only for leaving it deliberately (abandon) or for another account. */
  const drop = useCallback(() => {
    stopPolling();
    flowRef.current = null;
    put(null, studioAgentsEnabled() ? IDLE : OFF);
  }, [put, stopPolling]);

  const reset = useCallback(() => {
    if (committed(flowRef.current)) return;
    drop();
  }, [committed, drop]);

  const abandon = useCallback(async () => {
    const f = flowRef.current;
    if (!f || f.running || f.sending || stateRef.current.kind !== "settlement_pending") return;
    drop();
  }, [drop]);

  const ask = useCallback(async (agent: StudioAgent, symbol: AdviceSymbol) => {
    if (!studioAgentsEnabled() || ADVICE_SPLITTER === null) {
      put(null, OFF);
      return;
    }
    if (flowRef.current?.running || committed(flowRef.current)) return;
    stopPolling();
    const f: Flow = {
      key: newIdempotencyKey(), agent, symbol, expected: agent.price.micro, terms: null, quote: null, payment: null,
      uncertain: false, pending: false, wallet: undefined, jobId: null, settlement: null, retry: null, running: false, sending: false,
    };
    flowRef.current = f;
    await step(f, () => quote(f));
  }, [committed, put, quote, step, stopPolling]);

  const acceptPrice = useCallback(async () => {
    const f = flowRef.current;
    const s = stateRef.current;
    if (!f || s.kind !== "price_changed") return;
    // Nothing was signed: the same key asks again, and the confirmation shows the new price before anything is signed.
    f.expected = s.price;
    await step(f, () => quote(f));
  }, [quote, step]);

  const confirm = useCallback(async () => {
    const f = flowRef.current;
    if (!f || stateRef.current.kind !== "confirming" || f.terms === null || f.quote === null) return;
    await step(f, async () => {
      put(f, { kind: "signing", quote: f.quote! });
      let payment: string;
      try {
        const w = await open();
        if (!live(f)) return;
        f.wallet = w;
        const authorization = buildAuthorization({ from: w.address as Hex, terms: f.terms!, now: Date.now(), salt: randomSalt() });
        const signature = await w.account.signTypedData(typedData(authorization));
        if (!SIGNATURE.test(signature)) throw new Error("The wallet returned a signature that is not 65 bytes. Nothing was sent.");
        payment = encodePayment(authorization, signature);
      } catch (e) {
        // Nothing was sent: Face ID cancelled leaves the Ask, and the next one gets a new key.
        fail(f, e, IDLE);
        return;
      }
      if (!live(f)) return;
      f.payment = payment;
      await pay(f);
    });
  }, [fail, live, open, pay, put, step]);

  const retry = useCallback(async () => {
    const f = flowRef.current;
    const s = stateRef.current;
    if (!f || !(s.kind === "offline" || s.kind === "busy")) return;
    if (s.kind === "busy") {
      await step(f, () => replay(f, { kind: "busy", retrying: true }, { kind: "busy", retrying: false }));
      return;
    }
    // A pending settlement never resends its header; anything else repeats its own step.
    if (f.pending) await step(f, () => replay(f, CHECKING, PENDING));
    else if (f.retry) await f.retry();
  }, [replay, step]);

  const checkAgain = useCallback(async () => {
    const f = flowRef.current;
    if (!f || stateRef.current.kind !== "settlement_pending") return;
    await step(f, () => replay(f, CHECKING, PENDING));
  }, [replay, step]);

  const refresh = useCallback(async () => {
    const f = flowRef.current;
    const s = stateRef.current;
    if (!f || s.kind !== "timeout" || f.jobId === null) return;
    await step(f, async () => {
      const since = Date.now();
      put(f, { kind: "waiting", jobId: f.jobId!, since, settlement: f.settlement });
      let response: { ok: true; recommendation: Recommendation } | { ok: false };
      try {
        // A tap: this read may open the wallet. It is a GET of the same job, never a payment.
        response = { ok: true, recommendation: await authed(f, (fetch) => getRecommendation(fetch, f.jobId!)) };
      } catch (e) {
        if (e instanceof Cancelled) {
          put(f, s);
          return;
        }
        response = { ok: false };
      }
      if (!live(f)) return;
      const next = nextPoll(startPoll(since), response, since);
      if (next.kind === "done") put(f, { kind: "done", recommendation: next.recommendation, settlement: f.settlement });
      else if (next.kind === "failed") put(f, { kind: "failed", error: next.error, refundOwed: true, settlement: f.settlement });
      else poll(f, startPoll(since), POLL_INTERVAL_MS);
    });
  }, [authed, live, poll, put, step]);

  // Backgrounded on the confirmation: coming back shows the screen idle, and the next Ask asks again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" && stateRef.current.kind === "confirming") reset();
    });
    return () => sub.remove();
  }, [reset]);

  // Another account (or none): this Ask is dropped from view, paid or not. Its continuations are discarded (`live`),
  // polling stops, and nothing is ever signed for it by the new account; a paid analysis stays in the old account's
  // history.
  const seenAddress = useRef(address);
  useEffect(() => {
    if (seenAddress.current === address) return;
    seenAddress.current = address;
    drop();
  }, [address, drop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return { state, ask, acceptPrice, confirm, retry, checkAgain, refresh, reset, abandon };
}
