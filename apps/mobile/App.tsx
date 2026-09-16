import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { AccountState } from "./src/account";
import { Home } from "./src/screens/Home";
import { Welcome } from "./src/screens/Welcome";
import { clearStoredAccount, loadStoredAccount } from "./src/storage/storage";
import { palette } from "./src/ui/theme";
import type { Wallet } from "./src/wallet/wallet";

export default function App() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const ref = useRef(account);
  ref.current = account;

  // Termina la sesión de firma saliente cuando la wallet deja el estado.
  const replace = useCallback((next: AccountState) => {
    const cur = ref.current;
    if (cur?.status === "unlocked" && (next.status !== "unlocked" || next.wallet !== cur.wallet)) {
      cur.wallet.session.end();
    }
    ref.current = next;
    setAccount(next);
  }, []);

  // Arranque: solo la dirección (sin gate). Nada de Face ID aquí.
  useEffect(() => {
    let stale = false;
    loadStoredAccount()
      .then((s) => !stale && setAccount(s ? { status: "locked", ...s } : { status: "none" }))
      .catch(() => !stale && setAccount({ status: "none" }));
    return () => {
      stale = true;
    };
  }, []);

  const onWallet = (wallet: Wallet) => replace({ status: "unlocked", wallet });
  const onLock = () => {
    const cur = ref.current;
    if (cur?.status === "unlocked") {
      replace({ status: "locked", address: cur.wallet.address, credentialId: cur.wallet.credentialId });
    }
  };
  const onSignOut = async () => {
    await clearStoredAccount();
    replace({ status: "none" });
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.root}>
        {account === null ? (
          <View style={styles.center}><ActivityIndicator color={palette.text} /></View>
        ) : account.status === "none" ? (
          <Welcome onWallet={onWallet} />
        ) : (
          <Home account={account} onUnlock={onWallet} onLock={onLock} onSignOut={onSignOut} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: "center" },
});
