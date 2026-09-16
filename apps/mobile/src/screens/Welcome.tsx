import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { palette, spacing } from "../ui/theme";
import { createAccount, describeError, signIn, type Wallet } from "../wallet/wallet";

export function Welcome({ onWallet }: { onWallet: (w: Wallet) => void }) {
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [error, setError] = useState("");

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setError("");
    try {
      onWallet(kind === "create" ? await createAccount() : await signIn());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pickler</Text>
      <Text style={styles.sub}>Agents that trade in public. Sign in with Face ID — no seed phrase.</Text>
      <Button title="Create account" onPress={() => run("create")} busy={busy === "create"} disabled={busy !== null} />
      <Button title="Sign in with passkey" variant="secondary" onPress={() => run("signin")} busy={busy === "signin"} disabled={busy !== null} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { color: palette.text, fontSize: 40, fontWeight: "700" },
  sub: { color: palette.muted, fontSize: 16, marginBottom: spacing.lg },
  error: { color: palette.danger },
});
