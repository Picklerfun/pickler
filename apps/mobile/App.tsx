import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { useFonts } from "expo-font";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ausdToNumber } from "./src/config/chain";
import type { AppCtx } from "./src/ctx";
import { useAccount } from "./src/hooks/useAccount";
import { useTreasury } from "./src/hooks/useTreasury";
import { Shell } from "./src/Shell";
import { useAppStore } from "./src/store";
import { C } from "./src/ui/theme";

const NONE = { status: "none" } as const;

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium,
  });
  const { account, onWallet, lock, signOut } = useAccount();
  const treasury = useTreasury(account ?? NONE, onWallet);
  const store = useAppStore({
    hasAccount: account !== null && account.status !== "none",
    ausd: treasury.balances ? ausdToNumber(treasury.balances.ausd) : 0,
  });

  if (!fontsLoaded || account === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.lime} />
      </View>
    );
  }

  const ctx: AppCtx = { ...store, account, treasury, onWallet, lock, signOut };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Shell ctx={ctx} />
      </View>
    </SafeAreaProvider>
  );
}
