import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountState, accountAddress } from "../account";
import { type RefreshErrors, refreshOk, type Screen, updatedLabel } from "../store";

export type RefreshSeal = {
  updatedAt: Partial<Record<Screen, number>>;
  failed: Screen | null;
  /** Lo llama Page al terminar un jalón: sella o marca COULDN'T REFRESH con los errores de ese momento (P4 de mobile-loading). */
  onRefreshDone: (screen: Screen) => void;
  labelFor: (screen: Screen) => string | null;
  failedOn: (screen: Screen) => boolean;
};

/** Sello UPDATED / COULDN'T REFRESH por pantalla (spec mobile-loading D5), fuera del Shell: lo consume cada Page. */
export function useRefreshSeal({ account, errors, hasData }: { account: AccountState; errors: RefreshErrors; hasData: (screen: Screen) => boolean }): RefreshSeal {
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Screen, number>>>({});
  const [failed, setFailed] = useState<Screen | null>(null);
  // Los errores del render actual, leídos al terminar el jalón sin depender de closures viejas.
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const hasDataRef = useRef(hasData);
  hasDataRef.current = hasData;

  const onRefreshDone = useCallback((screen: Screen) => {
    if (refreshOk(screen, errorsRef.current)) { setUpdatedAt((u) => ({ ...u, [screen]: Date.now() })); setFailed(null); return; }
    setFailed(screen);
  }, []);
  useEffect(() => {
    if (failed === null) return;
    const t = setTimeout(() => setFailed(null), 3000);
    return () => clearTimeout(t);
  }, [failed]);

  // Sello inicial: la primera vez que una pantalla tiene su dato principal (P5 de mobile-loading). Page lo pide por pantalla.
  const seen = useRef(new Set<Screen>());
  const markInitial = useCallback((screen: Screen) => {
    if (seen.current.has(screen) || !hasDataRef.current(screen)) return;
    seen.current.add(screen);
    setUpdatedAt((u) => (u[screen] === undefined ? { ...u, [screen]: Date.now() } : u));
  }, []);

  // Otra cuenta = otro sello (I1 de la revisión final de mobile-loading).
  const address = accountAddress(account);
  useEffect(() => { setUpdatedAt({}); setFailed(null); seen.current.clear(); }, [address]);

  const labelFor = useCallback((screen: Screen) => {
    markInitial(screen);
    const ts = updatedAt[screen];
    return ts === undefined ? null : updatedLabel(ts);
  }, [updatedAt, markInitial]);
  const failedOn = useCallback((screen: Screen) => failed === screen, [failed]);

  return { updatedAt, failed, onRefreshDone, labelFor, failedOn };
}
