import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from "@expo-google-fonts/chakra-petch";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { useFonts } from "expo-font";
import { useEffect, useLayoutEffect, useRef } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AppCtx } from "./src/ctx";
import { useAccount } from "./src/hooks/useAccount";
import { usePerpl } from "./src/hooks/usePerpl";
import { useTreasury } from "./src/hooks/useTreasury";
import { Shell } from "./src/Shell";
import { type Screen, useAppStore } from "./src/store";
import { C } from "./src/ui/theme";

const NONE = { status: "none" } as const;
const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds"];

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
  const booted = useRef(false);
  const { boot } = store;
  // Una sola vez, cuando la cuenta deja de ser null: sin cuenta pasa por Sign in (D3).
  // useLayoutEffect (no useEffect): corre antes del paint, para no flashear Wallet un frame sin cuenta.
  useLayoutEffect(() => {
    if (account === null || booted.current) return;
    booted.current = true;
    boot(hasAccount);
  }, [account, hasAccount, boot]);
  const perpsActive = PERPL_SCREENS.includes(store.S.screen);
  const { setActive } = perpl;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);

  if (!fontsLoaded || account === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bgBottom, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.lime} />
      </View>
    );
  }

  const ctx: AppCtx = { ...store, account, treasury, perpl, onWallet, lock, signOut };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
        <Shell ctx={ctx} />
      </View>
    </SafeAreaProvider>
  );
}
