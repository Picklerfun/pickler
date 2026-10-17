// Studio agents at the level of the app (plan 2026-10-12-studio-agents-app, Task 4): the marketplace list and the one
// paid Ask in flight. App.tsx calls this hook once and hands it to every screen through AppCtx, above the per-tab stacks,
// so leaving the advice screen (back, another tab) and coming back finds the same Ask with its guards: its
// Idempotency-Key, its signed header and its job id are never dropped by a screen unmounting.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountState } from "../account";
import { fetchStudioAgents, history } from "../advice/api";
import type { AdviceHistory, AdviceSymbol, StudioAgent } from "../advice/types";
import { studioAgentsEnabled } from "../config/advice";
import { API_URL } from "../config/api";
import type { AuthedFetch } from "../identity/api";
import type { Wallet } from "../wallet/wallet";
import { type AdviceAsk, useAdviceAsk } from "./useAdviceAsk";
import { useUnlock } from "./useUnlock";

export type Studio = {
  /** PICKLER_API_URL and the pinned splitter are both set (src/config/advice.ts). Off, nothing here runs. */
  enabled: boolean;
  /** null until the first answer. */
  agents: StudioAgent[] | null;
  agentsError: string | null;
  refresh: () => Promise<void>;
  nextCursor: string | null;
  loadMore: () => Promise<void>;
  /** The paid Ask: one at a time for the whole app. */
  advice: AdviceAsk;
  /** The agent's free completed history. `open` unlocks the wallet first (Face ID); without it a locked wallet throws. */
  history: (agentId: string, symbol: AdviceSymbol, open: boolean) => Promise<AdviceHistory>;
};

/** `active`: a screen that shows Studio agents is focused; the list is read then, not in the background. */
export function useStudio(account: AccountState, onUnlock: (w: Wallet) => void, authedFetch: AuthedFetch, active: boolean): Studio {
  const enabled = studioAgentsEnabled();
  const advice = useAdviceAsk(account, onUnlock, authedFetch);
  const unlock = useUnlock(account, onUnlock);
  const [agents, setAgents] = useState<StudioAgent[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const loading = useRef(false);
  const [nextCursor,setNextCursor] = useState<string|null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || API_URL === null || loading.current) return;
    loading.current = true;
    try {
      const page = await fetchStudioAgents(API_URL);
      setAgents(page.items);
      setNextCursor(page.nextCursor);
      setAgentsError(null);
    } catch {
      setAgentsError("Couldn't reach Pickler. Check your connection and try again.");
    } finally {
      loading.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const loadMore = useCallback(async () => {
    if (!enabled || !API_URL || !nextCursor || loading.current) return;
    loading.current = true;
    try {
      const page = await fetchStudioAgents(API_URL,fetch,nextCursor);
      setAgents((items) => [...new Map([...(items ?? []),...page.items].map((item) => [item.id,item])).values()]);
      setNextCursor(page.nextCursor);
      setAgentsError(null);
    } catch { setAgentsError("Couldn't load more agents. Try again."); }
    finally { loading.current = false; }
  },[enabled,nextCursor]);

  const readHistory = useCallback(async (agentId: string, symbol: AdviceSymbol, open: boolean) => {
    const wallet = open ? await unlock() : undefined;
    return history((path, init) => authedFetch(path, init, wallet), agentId, symbol);
  }, [authedFetch, unlock]);

  return { enabled, agents, agentsError, refresh, nextCursor, loadMore, advice, history: readHistory };
}
