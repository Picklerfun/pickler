"use client";
import { useEffect, useRef, useState } from "react";
import { SessionExpired } from "@/features/auth/lib/custody";
import { StudioError, errorCode, transferConfirm, transferPrepare } from "../api";
import { relyingParty, stampActivity } from "../lib/passkey";
import type { SheetPhase } from "./passkey-sheet";
import { failedTransfer, moveBody, transferFailure, type Move } from "./transfer-model";

/** The two names a WebAuthn prompt fails with when the person closed it or it timed out. */
const CLOSED_PROMPT = new Set(["NotAllowedError", "AbortError"]);
/** How long the sheet shows its "Moved" before it closes. */
const DONE_MS = 650;

/** The move the sheet is signing, with its words fixed when Send was pressed. */
export interface PendingTransfer {
  move: Move;
  amount: string;
  copy: { title: string; body: string; done: string };
}

/**
 * One transfer in the passkey sheet: prepare, the person's stamp, confirm (spec §4.2). What a
 * failure means is `transfer-model.ts`'s: a cancellation before the stamp offers Try again, and
 * anything after it is an unknown outcome that reads the wallets again.
 */
export function useTransfer({
  preview,
  onMoved,
  onDone,
}: {
  preview: boolean;
  /** A transfer went through, or may have: read the wallets again. */
  onMoved(): void;
  /** It went through and the sheet has closed. */
  onDone(walletId: string): void;
}) {
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [phase, setPhase] = useState<SheetPhase>("idle");
  const [error, setError] = useState("");
  /* A transfer is in flight: a second press starts nothing. */
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = pending !== null && phase === "busy";

  /* Every `mounted` check below also skips onMoved after unmount. That is harmless: the transfer
     itself is never aborted, and the screen that would show the new balances is gone; whatever
     opens next reads the wallets on mount. */
  async function sign() {
    if (!pending || running.current || preview) {
      return;
    }
    running.current = true;
    setPhase("busy");
    setError("");
    let stamped = false;
    try {
      // Every transfer body goes through toTransferBody (moveBody): the server does not trim.
      const body = moveBody(pending.move, pending.amount);
      const unsigned = await transferPrepare(body);
      const signed = await stampActivity(await relyingParty(), unsigned);
      stamped = true;
      await transferConfirm(body, signed);
    } catch (caught) {
      const outcome = failedTransfer({
        closedPrompt: caught instanceof Error && CLOSED_PROMPT.has(caught.name),
        code: errorCode(caught),
        stamped,
      });
      // "done": an earlier confirm already recorded it, and the sheet goes on to "Moved".
      if (outcome !== "done") {
        running.current = false;
        if (mounted.current) {
          failed(outcome, caught, stamped);
        }
        return;
      }
    }
    if (!mounted.current) {
      running.current = false;
      return;
    }
    setPhase("ok");
    setTimeout(() => {
      running.current = false;
      if (!mounted.current) {
        return;
      }
      setPending(null);
      setPhase("idle");
      onDone(pending.move.walletId);
      onMoved();
    }, DONE_MS);
  }

  function failed(outcome: "cancelled" | "failed", caught: unknown, stamped: boolean) {
    if (outcome === "cancelled") {
      setPhase("err");
      return;
    }
    setPending(null);
    setPhase("idle");
    setError(
      transferFailure({
        sessionExpired: caught instanceof SessionExpired,
        studio:
          caught instanceof StudioError ? { code: caught.code, message: caught.message } : null,
        stamped,
      }),
    );
    // Stamped, it may have gone through: the balances say whether it did.
    if (stamped) {
      onMoved();
    }
  }

  function start(next: PendingTransfer) {
    if (running.current || preview) {
      return;
    }
    setError("");
    setPhase("idle");
    setPending(next);
  }

  function closeSheet() {
    if (busy || phase === "ok") {
      return;
    }
    setPending(null);
    setPhase("idle");
  }

  return { pending, phase, busy, error, setError, start, sign, closeSheet };
}
