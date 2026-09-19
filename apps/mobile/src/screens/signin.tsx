import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import { Btn, Card, Page, T } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

export function SigninScreen({ held, onWallet, finishSignin }: AppCtx) {
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [error, setError] = useState("");
  const off = busy !== null;

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setError("");
    try {
      const wallet = kind === "create" ? await createAccount() : await signIn();
      onWallet(wallet);
      finishSignin();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page top={18} gap={12}>
      {held ? (
        <Card bd={C.vioBd45} bg={C.vioBg08} pad={12} radius={12}>
          <T w={700} s={12.5} lh={1.3}>We kept what you were about to do</T>
          <T w={400} s={11.5} lh={1.45} color={C.dim} style={{ marginTop: 4 }}>{held}. You come straight back after this step.</T>
        </Card>
      ) : null}
      <T w={400} s={12.5} lh={1.5} color={C.dim}>Reading and following never need an account. The wallet appears the first time money moves.</T>
      <View style={{ gap: 8 }}>
        <View style={{ position: "relative" }}>
          <Btn label={busy === "create" ? " " : "Create a wallet"} onPress={() => run("create")} variant="lime" s={13.5} py={15} disabled={off && busy !== "create"} busy={busy === "create"} accessibilityLabel="create-wallet" />
          {busy === "create" ? <ActivityIndicator color={C.onLime} style={{ position: "absolute", alignSelf: "center", top: 13 }} /> : null}
        </View>
        <View style={{ position: "relative" }}>
          <Btn label={busy === "signin" ? " " : "I already have one"} onPress={() => run("signin")} variant="outline" s={13.5} py={15} disabled={off && busy !== "signin"} busy={busy === "signin"} accessibilityLabel="sign-in" />
          {busy === "signin" ? <ActivityIndicator color={C.ink} style={{ position: "absolute", alignSelf: "center", top: 13 }} /> : null}
        </View>
      </View>
      {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
      <T w={400} s={11} lh={1.4} color={C.faint}>Connecting is not signing. Every operation is confirmed on its own.</T>
    </Page>
  );
}
