"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentState, studioWallets } from "../api";
import type { NewAgentStaged } from "./fixture";
import {
  applyRead,
  failRead,
  initialReads,
  markApproved,
  markDelegated,
  policiesApproved,
} from "./wallet-reads";

const READ_FAILED = "Your wallets could not be read. Refresh to try again.";

/** The wallets with their balances, and whether Pickler's delegated user exists yet. */
const readWallets = () => Promise.all([studioWallets(), agentState()]);
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The create screen's wallet reads: one on mount, one per `refresh()`. Each read is numbered as it
 * starts and `wallet-reads.ts` drops an answer older than the newest, so reads that resolve out of
 * order never step back. A staged screen reads nothing.
 */
export function useAgentWallet(preview: boolean, staged: NewAgentStaged | null) {
  const [reads, setReads] = useState(() => initialReads(staged));
  const [refreshing, setRefreshing] = useState(false);
  const readSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback((seq: number, read: ReturnType<typeof readWallets>) => {
    return read.then(
      ([wallets, state]) => {
        if (mounted.current) {
          setReads((current) =>
            applyRead(current, {
              seq,
              wallets,
              delegated: state.hasDelegatedUser,
              at: clock(wallets.readAt),
            }),
          );
        }
        return true;
      },
      () => {
        if (mounted.current) {
          setReads((current) => failRead(current, { seq, message: READ_FAILED }));
        }
        return false;
      },
    );
  }, []);

  useEffect(() => {
    if (preview) {
      return;
    }
    readSeq.current += 1;
    void settle(readSeq.current, readWallets());
  }, [preview, settle]);

  const refresh = useCallback(async () => {
    if (preview) {
      return false;
    }
    readSeq.current += 1;
    const seq = readSeq.current;
    setRefreshing(true);
    const succeeded = await settle(seq, readWallets());
    // A newer refresh is still in flight: it clears the flag when it lands.
    if (mounted.current && seq === readSeq.current) {
      setRefreshing(false);
    }
    return succeeded;
  }, [preview, settle]);

  const approve = useCallback((walletId: string) => {
    setReads((current) => markApproved(current, walletId));
  }, []);
  const delegate = useCallback(() => {
    setReads((current) => markDelegated(current));
  }, []);

  return {
    ...reads,
    policiesApproved: policiesApproved(reads),
    refreshing,
    refresh,
    approve,
    delegate,
  };
}
