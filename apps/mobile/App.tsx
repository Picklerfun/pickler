import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AppCtx } from "./src/ctx";
import { DevControls } from "./src/DevControls";
import { useAccount } from "./src/hooks/useAccount";
import { useCurrentScreen } from "./src/hooks/useCurrentScreen";
import { useMarketData } from "./src/hooks/useMarketData";
import { useNotifications } from "./src/hooks/useNotifications";
import { usePerpl } from "./src/hooks/usePerpl";
import { useReads } from "./src/hooks/useReads";
import { useRefreshSeal } from "./src/hooks/useRefreshSeal";
import { useTreasury } from "./src/hooks/useTreasury";
import { AppCtxProvider } from "./src/navigation/context";
import { Navigator } from "./src/navigation/Navigator";
import type { PushTarget } from "./src/reads/push";
import { patchForPush } from "./src/reads/push";
import { type Screen, screenHasData, useAppStore } from "./src/store";

const NONE = { status: "none" } as const;
const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds"];

// Splash nativo (spec mobile-loading D7): se queda hasta que la cuenta local se resolvió; 2 s de tope por si el almacenamiento no responde.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    "ArchivoPickler-Bold": require("./assets/fonts/ArchivoPickler-Bold.ttf"),
  });
  const { account, onWallet, lock, signOut } = useAccount();
  const treasury = useTreasury(account ?? NONE, onWallet);
  const perpl = usePerpl(account ?? NONE, onWallet, treasury);
  const hasAccount = account !== null && account.status !== "none";
  const scr = useCurrentScreen();
  const store = useAppStore({ hasAccount, scr });
  const { requireAccount } = store;
  // Tap en un push (P7 de Ask): abre Market en la read (o en Trade para un recordatorio) respetando el gate.
  // En frío, la última respuesta llega antes de que la cuenta cargue (account === null): se encola y se
  // navega cuando la cuenta se conoce, para que el gate no mande a Sign in a quien sí tiene wallet.
  // La cola por cuenta se conserva; el adaptador encola además hasta que el container está listo (isReady).
  const pendingPush = useRef<PushTarget | null>(null);
  const accountLoaded = account !== null;
  const accountLoadedRef = useRef(accountLoaded);
  accountLoadedRef.current = accountLoaded;
  const onPushTarget = useCallback((t: PushTarget) => {
    if (!accountLoadedRef.current) { pendingPush.current = t; return; }
    requireAccount("market", patchForPush(t));
  }, [requireAccount]);
  useEffect(() => {
    if (!accountLoaded || pendingPush.current === null) return;
    const t = pendingPush.current;
    pendingPush.current = null;
    requireAccount("market", patchForPush(t));
  }, [accountLoaded, requireAccount]);
  const notifications = useNotifications(onPushTarget);
  const reads = useReads(account ?? NONE, onWallet, notifications, store.S.perpsMarketId);
  const ready = fontsLoaded && account !== null;
  useEffect(() => {
    if (ready) { void SplashScreen.hideAsync(); return; }
    const t = setTimeout(() => { void SplashScreen.hideAsync(); }, 2000);
    return () => clearTimeout(t);
  }, [ready]);
  const perpsActive = PERPL_SCREENS.includes(scr);
  const readsActive = scr === "market" && store.S.marketTab !== "trade";
  // Order book (D11, P5): sólo con Trade visible y trading key (sin key, el gate no muestra el book).
  const bookActive = scr === "market" && store.S.marketTab === "trade" && perpl.state.status === "ready";
  const marketData = useMarketData(store.S.perpsMarketId, bookActive);
  const { setActive } = perpl;
  const { setActive: setReadsActive } = reads;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);
  useEffect(() => { setReadsActive(readsActive); }, [readsActive, setReadsActive]);
  const [controls, setControls] = useState(false);
  const seal = useRefreshSeal({
    account: account ?? NONE,
    errors: { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.session === "ready" ? reads.listError : null },
    hasData: (s) => screenHasData(s, { balances: treasury.balances, context: perpl.context }),
  });
  // La ruta inicial se decide una sola vez, cuando la cuenta ya se conoce (D5): con cuenta Tabs, sin cuenta signin.
  const initial = useRef<"Tabs" | "signin" | null>(null);
  if (ready && initial.current === null) initial.current = hasAccount ? "Tabs" : "signin";

  if (!ready || initial.current === null) return null; // el splash nativo sigue en pantalla (P9)

  const ctx: AppCtx = { ...store, account, treasury, perpl, marketData, reads, notifications, onWallet, lock, signOut, seal, setControls };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <AppCtxProvider value={ctx}>
          <Navigator initial={initial.current} />
          {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
        </AppCtxProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
