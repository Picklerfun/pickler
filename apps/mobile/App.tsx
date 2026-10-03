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
import { useIdentity } from "./src/hooks/useIdentity";
import { useMarketData } from "./src/hooks/useMarketData";
import { useNotifications } from "./src/hooks/useNotifications";
import { usePerpl } from "./src/hooks/usePerpl";
import { useReads } from "./src/hooks/useReads";
import { useRefreshSeal } from "./src/hooks/useRefreshSeal";
import { useTreasury } from "./src/hooks/useTreasury";
import { AppCtxProvider } from "./src/navigation/context";
import { Navigator } from "./src/navigation/Navigator";
import type { PushTarget } from "./src/reads/push";
import { pushTarget } from "./src/reads/push";
import { UsernameGate } from "./src/screens/username";
import { accountAddress } from "./src/account";
import { appQuiet, gateShows, perplOnboardingActive } from "./src/identity/state";
import { perplActiveFor, readsActiveFor, screenHasData, useAppStore } from "./src/store";

const NONE = { status: "none" } as const;

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
  // Tap en un push (D22): abre la pantalla Read en la read (o Market en Trade para un recordatorio) respetando el gate.
  // En frío, la última respuesta llega antes de que la cuenta cargue (account === null): se encola y se
  // navega cuando la cuenta se conoce, para que el gate no mande a Sign in a quien sí tiene wallet.
  // La cola por cuenta se conserva; el adaptador encola además hasta que el container está listo (isReady).
  const pendingPush = useRef<PushTarget | null>(null);
  const accountLoaded = account !== null;
  const accountLoadedRef = useRef(accountLoaded);
  accountLoadedRef.current = accountLoaded;
  const onPushTarget = useCallback((t: PushTarget) => {
    if (!accountLoadedRef.current) { pendingPush.current = t; return; }
    const { screen, patch } = pushTarget(t);
    requireAccount(screen, patch);
  }, [requireAccount]);
  useEffect(() => {
    if (!accountLoaded || pendingPush.current === null) return;
    const t = pendingPush.current;
    pendingPush.current = null;
    const { screen, patch } = pushTarget(t);
    requireAccount(screen, patch);
  }, [accountLoaded, requireAccount]);
  const notifications = useNotifications(onPushTarget);
  const reads = useReads(account ?? NONE, onWallet, notifications, store.S.perpsMarketId);
  // La cuenta en la API del producto: la misma que en la web. Sin PICKLER_API_URL no hace nada.
  const identity = useIdentity(account ?? NONE, onWallet);
  const ready = fontsLoaded && account !== null;
  useEffect(() => {
    if (ready) { void SplashScreen.hideAsync(); return; }
    const t = setTimeout(() => { void SplashScreen.hideAsync(); }, 2000);
    return () => clearTimeout(t);
  }, [ready]);
  const perpsActive = perplActiveFor(scr);
  const readsActive = readsActiveFor(scr, store.S.marketTab);
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
  // La pantalla del username ya se mostró: se queda aunque empiece una operación debajo. Declarado aquí, antes del
  // `return null` de carga: un hook después de un return temprano cambia la cuenta de hooks entre renders y React
  // revienta al arrancar (__tests__/app-hooks.test.ts lo vigila).
  const gateShown = useRef(false);
  // La ruta inicial se decide una sola vez, cuando la cuenta ya se conoce (D5): con cuenta Tabs, sin cuenta signin.
  const initial = useRef<"Tabs" | "signin" | null>(null);
  if (ready && initial.current === null) initial.current = hasAccount ? "Tabs" : "signin";

  if (!ready || initial.current === null) return null; // el splash nativo sigue en pantalla (P9)

  const ctx: AppCtx = { ...store, account, treasury, perpl, marketData, reads, identity, notifications, onWallet, lock, signOut, seal, setControls };
  // La pantalla del username no cae encima de una operación en curso: quien desbloqueó para retirar, pedir una read o
  // habilitar trading en Perpl ve primero cómo termina (src/identity/state.ts). Una vez abierta se queda.
  const quiet = appQuiet({ treasuryBusy: treasury.busy, readPending: reads.request.step === "pending", perplOnboarding: perplOnboardingActive(perpl.state) });
  gateShown.current = gateShows(identity.identity, gateShown.current, quiet);
  const gateAddress = gateShown.current ? accountAddress(account) : null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <AppCtxProvider value={ctx}>
          <Navigator initial={initial.current} />
          {/* El username es obligatorio: mientras la cuenta no tenga uno, esto tapa la app. Fuera del árbol de navegación
              a propósito: no es una pantalla a la que se llega ni de la que se vuelve. */}
          {gateAddress ? <UsernameGate identity={identity} address={gateAddress} onSignOut={() => { void signOut().then(store.signedOut); }} /> : null}
          {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
        </AppCtxProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
