import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { accountAddress, type AccountState } from "../account";
import { EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL } from "../config/chain";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { palette, spacing } from "../ui/theme";
import { readBalances, requestAusdFromFaucet, waitForReceipt } from "../wallet/chain";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

type Props = {
  account: Exclude<AccountState, { status: "none" }>;
  onUnlock: (w: Wallet) => void;
  onLock: () => void;
  onSignOut: () => void;
};

export function Home({ account, onUnlock, onLock, onSignOut }: Props) {
  const address = accountAddress(account)!;
  const [balances, setBalances] = useState<{ ausd: bigint; mon: bigint } | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRpcError("");
    try {
      setBalances(await readBalances(address));
    } catch (e) {
      setBalances(null);
      setRpcError(describeError(e));
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function getTestAusd() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let wallet: Wallet;
      if (account.status === "unlocked") {
        wallet = account.wallet;
      } else {
        const unlocked = await unlockStoredWallet();
        if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
        wallet = unlocked;
        onUnlock(wallet);
      }
      if (balances && balances.mon === 0n) {
        throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
      }
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await waitForReceipt(hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
      await refresh();
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const txHash = notice.split(": ")[1];

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Treasury</Text>
      <Field label="Address (Monad Testnet)" value={address} />
      <Button title="Copy address" variant="secondary" onPress={() => Clipboard.setStringAsync(address)} />
      <Field label="AUSD" value={balances ? formatAusd(balances.ausd) : "—"} />
      <Field label="MON (gas)" value={balances ? formatMon(balances.mon) : "—"} />
      {rpcError ? (
        <>
          <Text style={styles.error}>{rpcError}</Text>
          <Button title="Retry" variant="secondary" onPress={refresh} />
        </>
      ) : null}
      <Button title="Get test AUSD" onPress={getTestAusd} busy={busy} />
      <Button title="Get test MON (opens faucet)" variant="secondary" onPress={() => Linking.openURL(MON_FAUCET_URL)} />
      {notice ? (
        <Text style={styles.notice} onPress={() => txHash && Linking.openURL(EXPLORER_TX_URL(txHash))}>
          {notice}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Text style={styles.status}>{account.status === "unlocked" ? "Unlocked" : "Locked"}</Text>
        {account.status === "unlocked" ? <Button title="Lock" variant="secondary" onPress={onLock} /> : null}
        <Button title="Sign out" variant="secondary" onPress={onSignOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.sm, padding: spacing.lg },
  title: { color: palette.text, fontSize: 28, fontWeight: "700", marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: "auto" },
  status: { color: palette.muted, flex: 1 },
  notice: { color: palette.success, fontSize: 12 },
  error: { color: palette.danger },
});
