import { useEffect, useState } from "react";
import { currentScreen, navigationRef } from "../navigation/ref";
import type { Screen } from "../store";

/** Pantalla enfocada según react-navigation (spec mobile-nav D4). Vale "wallet" hasta que el container tiene estado. */
export function useCurrentScreen(): Screen {
  const [scr, setScr] = useState<Screen>(() => currentScreen() ?? "wallet");
  useEffect(() => {
    const read = () => { const s = currentScreen(); if (s !== null) setScr(s); };
    read();
    return navigationRef.addListener("state", read);
  }, []);
  return scr;
}
