import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from "@expo-google-fonts/chakra-petch";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StatusBar, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AppCtx } from "./src/ctx";
import { useAccount } from "./src/hooks/useAccount";
import { useNotifications } from "./src/hooks/useNotifications";
import { usePerpl } from "./src/hooks/usePerpl";
import { useRefreshSeal } from "./src/hooks/useRefreshSeal";
import { useReads } from "./src/hooks/useReads";
import { useTreasury } from "./src/hooks/useTreasury";
import type { PushTarget } from "./src/reads/push";
import { patchForPush } from "./src/reads/push";
import { Shell } from "./src/Shell";
import { type Screen, screenHasData, useAppStore } from "./src/store";
import { C } from "./src/ui/theme";

const NONE = { status: "none" } as const;
const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds"];

// Splash nativo (spec mobile-loading D7): se queda hasta que la cuenta local se resolvió; 2 s de tope por si el almacenamiento no responde.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    ChakraPetch_600SemiBold, ChakraPetch_700Bold,
  });
  const { account, onWallet, lock, signOut } = useAccount();
  const treasury = useTreasury(account ?? NONE, onWallet);
  const perpl = usePerpl(account ?? NONE, onWallet, treasury);
  const hasAccount = account !== null && account.status !== "none";
  const store = useAppStore({ hasAccount, perpsMarkets: perpl.context?.markets ?? [] });
  const { requireAccount } = store;
  // Tap en un push: abre Market en la read (o en Trade para un recordatorio) respetando el gate (P7).
  // En frío, la última respuesta llega antes de que la cuenta cargue (account === null): se encola y se
  // navega cuando la cuenta se conoce, para que el gate no mande a Sign in a quien sí tiene wallet.
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
  const [controls, setControls] = useState(false); // Task 6 monta DevControls aquí; hasta entonces el Shell tiene el suyo
  void controls;
  const seal = useRefreshSeal({
    account: account ?? NONE,
    errors: { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.session === "ready" ? reads.listError : null },
    hasData: (s) => screenHasData(s, { balances: treasury.balances, context: perpl.context }),
  });
  const booted = useRef(false);
  const { boot } = store;
  // Una sola vez, cuando la cuenta deja de ser null: sin cuenta pasa por Sign in (D3).
  // useLayoutEffect (no useEffect): corre antes del paint, para no flashear Wallet un frame sin cuenta.
  useLayoutEffect(() => {
    if (account === null || booted.current) return;
    booted.current = true;
    boot(hasAccount);
  }, [account, hasAccount, boot]);
  const ready = fontsLoaded && account !== null;
  useEffect(() => {
    if (ready) { void SplashScreen.hideAsync(); return; }
    const t = setTimeout(() => { void SplashScreen.hideAsync(); }, 2000);
    return () => clearTimeout(t);
  }, [ready]);
  const perpsActive = PERPL_SCREENS.includes(store.S.screen);
  const readsActive = store.S.screen === "market" && store.S.marketTab !== "trade";
  const { setActive } = perpl;
  const { setActive: setReadsActive } = reads;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);
  useEffect(() => { setReadsActive(readsActive); }, [readsActive, setReadsActive]);

  if (!ready) return null; // el splash nativo sigue en pantalla (P9)

  const ctx: AppCtx = { ...store, account, treasury, perpl, reads, notifications, onWallet, lock, signOut, seal, setControls };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
          <Shell ctx={ctx} />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
