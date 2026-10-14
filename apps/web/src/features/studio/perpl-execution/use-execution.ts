"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PerplLiveStateDto, PerplLiveStartDto } from "@pickler/api-schema";
import {
  confirmPerplTrading,
  connectExistingPerplKey,
  controlPerplTrading,
  perplTradingState,
  preparePerplTrading,
  startPerplTrading,
  StudioError,
} from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";

const messages: Record<string, string> = {
  PERPL_UNAVAILABLE: "Perpl trading is not available for this agent yet.",
  PERPL_ADMISSIONS_PAUSED: "New trading sessions are currently paused.",
  PERPL_CREDENTIAL_INVALID:
    "The Perpl key could not be verified. Check its token and Ed25519 secret.",
  PERPL_ACCOUNT_REQUIRED:
    "This agent's wallet needs an existing Perpl account before connecting a key.",
  PERPL_FORWARDING_REQUIRED: "Enable order forwarding for this wallet's account in Perpl first.",
  PERPL_EVIDENCE_MISMATCH:
    "Perpl account or order data does not match this agent. Review its wallet and venue history.",
  PERPL_HTTP_401: "Perpl refused this key. It may be invalid, expired or revoked.",
  PERPL_SETUP_REQUIRED: "Prepare the agent's Perpl account first.",
  PERPL_SETUP_PENDING: "Finish the pending account step before preparing another.",
  PERPL_SETUP_UNKNOWN: "The account step is being checked. Do not sign it again.",
  PERPL_MARGIN_LIMIT: "The amount exceeds this agent's limits.",
  PERPL_DAY_LIMIT: "This agent's daily trading limit has been reached.",
  PERPL_ENTRIES_PAUSED: "Entries are paused. Its open positions can still close.",
  PERPL_SIGNATURE_REJECTED: "The authorization was refused. Prepare this step again.",
  PERPL_INSUFFICIENT_COLLATERAL: "There is not enough collateral in the Perpl account.",
  PERPL_ORDER_NOT_FILLED: "Perpl did not fill the order. Trading has stopped for review.",
  PERPL_SYNC_UNAVAILABLE: "Perpl has not answered. The last confirmed state is shown.",
  PERPL_UNEXPECTED_POSITION:
    "The account has a position outside this session. Review it before starting again.",
};
const unavailable: PerplLiveStateDto = {
  available: false,
  admissionsEnabled: false,
  network: "testnet",
  address: null,
  accountId: null,
  setupRequired: true,
  keyExpiresAt: null,
  setup: [],
  session: null,
  balanceAusd: null,
  observedAt: null,
  positions: [],
  orders: [],
};
export function perplExecutionMessage(error: unknown) {
  if (error instanceof StudioError) {
    return messages[error.code] ?? error.serverMessage ?? "Could not complete this Perpl action.";
  }
  if (typeof error === "string") {
    return messages[error] ?? "Perpl needs your attention before trading can continue.";
  }
  return "Could not reach Perpl trading. Check its status before trying again.";
}
export function usePerplExecution(
  agentId: string,
  preview: boolean,
  fixture: PerplLiveStateDto | null = null,
) {
  const [state, setState] = useState<PerplLiveStateDto | null>(
    fixture ?? (preview ? unavailable : null),
  );
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const startKey = useRef<string | null>(null);
  const setupKey = useRef<string | null>(null);
  const generation = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (preview) {
        return;
      }
      const own = generation.current;
      try {
        const next = await perplTradingState(agentId, signal);
        if (own === generation.current && !signal?.aborted) {
          setState(next);
          setReadError("");
        }
      } catch (caught) {
        if (own === generation.current && !signal?.aborted) {
          setReadError(perplExecutionMessage(caught));
        }
      }
    },
    [agentId, preview],
  );
  useEffect(() => {
    invalidate();
    startKey.current = null;
    setupKey.current = null;
    setBusy(lock.current);
    setState(fixture ?? (preview ? unavailable : null));
    setError("");
    setReadError("");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    async function poll() {
      if (!disposed && document.visibilityState !== "hidden") {
        await refresh(controller.signal);
      }
      if (!disposed && !preview) {
        const current = stateRef.current;
        const pending = current?.setup.some(
          (step) => !["confirmed", "failed"].includes(step.status),
        );
        const running = current?.session && ["active", "stopping"].includes(current.session.status);
        timer = setTimeout(() => void poll(), pending || running ? 5000 : 30000);
      }
    }
    void poll();
    const visible = () => {
      if (document.visibilityState === "visible") {
        void refresh(controller.signal);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      invalidate();
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, fixture, preview, invalidate]);
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (preview || lock.current) {
      return;
    }
    lock.current = true;
    const own = generation.current;
    const current = () => own === generation.current;
    setBusy(true);
    setError("");
    try {
      await work(current);
    } catch (caught) {
      if (current()) {
        setError(perplExecutionMessage(caught));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    state,
    error: error || readError,
    busy,
    preview,
    refresh,
    connectKey: (input: import("@pickler/api-schema").PerplLiveExistingKeyDto) =>
      run(async (current) => {
        const connected = await connectExistingPerplKey(agentId, input);
        if (current()) {
          setState(connected);
        }
      }),
    prepare: (collateralAusd: string) =>
      run(async (current) => {
        setupKey.current ??= crypto.randomUUID();
        const setup = await preparePerplTrading(agentId, collateralAusd, setupKey.current);
        if (!current()) {
          return;
        }
        setupKey.current = null;
        setState((old) =>
          old ? { ...old, setup: [...old.setup.filter((s) => s.id !== setup.id), setup] } : old,
        );
        await refresh();
      }),
    authorize: () =>
      run(async (current) => {
        const setup = state?.setup.at(-1);
        if (!setup?.activity || setup.status !== "awaiting_signature") {
          return;
        }
        const rp = await relyingParty();
        if (!current()) {
          return;
        }
        const signed = await stampActivity(rp, setup.activity);
        if (!current()) {
          return;
        }
        const result = await confirmPerplTrading(agentId, setup.id, signed);
        if (!current()) {
          return;
        }
        setState((old) =>
          old ? { ...old, setup: old.setup.map((s) => (s.id === result.id ? result : s)) } : old,
        );
        await refresh();
      }),
    start: (input: PerplLiveStartDto) =>
      run(async (current) => {
        startKey.current ??= crypto.randomUUID();
        try {
          const next = await startPerplTrading(agentId, input, startKey.current);
          if (!current()) {
            return;
          }
          setState(next);
          startKey.current = null;
        } catch (caught) {
          if (
            current() &&
            caught instanceof StudioError &&
            !["INTERNAL_OR_PROVIDER_FAILURE", "PERPL_UNAVAILABLE"].includes(caught.code)
          ) {
            startKey.current = null;
          }
          throw caught;
        }
      }),
    control: (action: "pause" | "resume" | "stop" | "close") =>
      run(async (current) => {
        const next = await controlPerplTrading(agentId, action);
        if (current()) {
          setState(next);
        }
      }),
  };
}
export type PerplExecution = ReturnType<typeof usePerplExecution>;
