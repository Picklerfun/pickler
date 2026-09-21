import { createContext, type ReactNode, useContext } from "react";
import type { AppCtx } from "../ctx";

// AppCtx por contexto (P2 del plan F1): react-navigation monta las pantallas con route/navigation; las nuestras
// siguen recibiendo ctx como props vía withPage. Vive aparte de Navigator.tsx para que Page/TabBar no importen
// el navegador (ciclo de módulos).
const Ctx = createContext<AppCtx | null>(null);
export function AppCtxProvider({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAppCtx(): AppCtx {
  const v = useContext(Ctx);
  if (v === null) throw new Error("useAppCtx fuera de AppCtxProvider");
  return v;
}
