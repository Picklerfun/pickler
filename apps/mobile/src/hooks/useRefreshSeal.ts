import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountState, accountAddress } from "../account";
import { REFRESHABLE, type RefreshErrors, refreshOk, type Screen, updatedLabel } from "../store";

export type RefreshSeal = {
  updatedAt: Partial<Record<Screen, number>>;
  failed: Screen | null;
  /** Lo llama Page al terminar un jalón: sella o marca COULDN'T REFRESH con los errores de ese momento (P4 de mobile-loading). */
  onRefreshDone: (screen: Screen) => void;
  labelFor: (screen: Screen) => string | null;
  failedOn: (screen: Screen) => boolean;
};

/** Sello UPDATED / COULDN'T REFRESH por pantalla (spec mobile-loading D5), fuera del Shell: lo consume cada Page.
 *  `onRefreshDone` sólo cuenta el jalón (contador + pantalla); el veredicto se decide en un efecto keyed en ese
 *  contador, que corre después del render con los errores frescos de ese render — igual que el Shell original
 *  evitaba leer `errorsRef` con datos viejos cuando el `finally` de un `await` corre antes de que React aplique
 *  los `setXError` (P4 de mobile-loading). */
export function useRefreshSeal({ account, errors, hasData }: { account: AccountState; errors: RefreshErrors; hasData: (screen: Screen) => boolean }): RefreshSeal {
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Screen, number>>>({});
  const [failed, setFailed] = useState<Screen | null>(null);
  const [done, setDone] = useState<{ n: number; screen: Screen | null }>({ n: 0, screen: null });

  // Page llama esto al terminar el jalón; sólo anota qué pantalla y cuenta. El veredicto vive en el efecto de abajo.
  const onRefreshDone = useCallback((screen: Screen) => setDone((d) => ({ n: d.n + 1, screen })), []);

  useEffect(() => {
    if (done.n === 0 || done.screen === null) return;
    const screen = done.screen;
    if (refreshOk(screen, errors)) { setUpdatedAt((u) => ({ ...u, [screen]: Date.now() })); setFailed(null); return; }
    setFailed(screen);
    const t = setTimeout(() => setFailed(null), 3000);
    return () => clearTimeout(t);
  }, [done]);

  const seen = useRef(new Set<Screen>());

  // Otra cuenta = otro sello (I1 de la revisión final de mobile-loading). Declarado ANTES del efecto de sello
  // inicial: los efectos corren en orden de declaración dentro del mismo commit, así que al cambiar de cuenta
  // este reset corre primero y el sello inicial se re-evalúa después, en el mismo commit.
  const address = accountAddress(account);
  useEffect(() => { setUpdatedAt({}); setFailed(null); seen.current.clear(); }, [address]);

  // Sello inicial: la primera vez que una pantalla tiene su dato principal (P5 de mobile-loading), calculado por
  // el propio hook (no por Page vía `markInitial` en render, que actualizaba estado durante el render de Page).
  // `address` en las deps: al cambiar de cuenta con datos ya cargados (`has` no cambia, p. ej. treasury.balances
  // sigue no-nulo entre dos cuentas fondeadas), este efecto igual se re-ejecuta y re-sella tras el reset de arriba.
  const has = REFRESHABLE.map((s) => hasData(s));
  useEffect(() => {
    REFRESHABLE.forEach((s, i) => {
      if (has[i] && !seen.current.has(s)) {
        seen.current.add(s);
        setUpdatedAt((u) => (u[s] === undefined ? { ...u, [s]: Date.now() } : u));
      }
    });
  }, [has[0], has[1], has[2], address]);

  const labelFor = useCallback((screen: Screen) => {
    const ts = updatedAt[screen];
    return ts === undefined ? null : updatedLabel(ts);
  }, [updatedAt]);
  const failedOn = useCallback((screen: Screen) => failed === screen, [failed]);

  return { updatedAt, failed, onRefreshDone, labelFor, failedOn };
}
