import { useEffect, useState } from "react";

/** Tick de `everyMs` para las cuentas regresivas de toda una pantalla (P14 de Ask F2; lo usan Ask y Trade). */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}
