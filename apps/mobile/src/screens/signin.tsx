import { useRoute } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { SigninParams } from "../navigation/routes";
import { shouldOnboard } from "../onboarding";
import { loadOnboarded } from "../storage/onboarding";
import { heldActionFor } from "../store";
import { Card, Icon, Page, Segmented, T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

type Mode = "in" | "up";
type Phase = { step: "idle" } | { step: "busy" } | { step: "done"; address: string };
const DONE_MS = 1000; // el banner ACCOUNT CREATED / WELCOME BACK se ve antes de navegar (D20)

export function SigninScreen({ onWallet, finishSignin, startOnboarding }: AppCtx) {
  const held = heldActionFor((useRoute().params as SigninParams)?.next);
  const [mode, setMode] = useState<Mode>("in");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState("");
  // El timeout sobrevive a un desmontaje de la pantalla (navegación durante el DONE_MS);
  // se limpia en el cleanup para no llamar finishSignin sobre una pantalla que ya no existe.
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  async function run() {
    setPhase({ step: "busy" });
    setError("");
    try {
      const wallet = mode === "up" ? await createAccount() : await signIn();
      onWallet(wallet);
      setPhase({ step: "done", address: wallet.address });
      const onboard = shouldOnboard(mode, await loadOnboarded());
      doneTimer.current = setTimeout(onboard ? startOnboarding : () => finishSignin(), DONE_MS);
    } catch (e) {
      setError(describeError(e));
      setPhase({ step: "idle" });
    }
  }

  const busy = phase.step === "busy";
  const done = phase.step === "done" ? phase : null;
  return (
    <Page top={8} gap={16}>
      <Segmented options={[["in", "Sign in"], ["up", "Sign up"]] as const} value={mode} onChange={(k) => { if (phase.step === "idle") setMode(k); }} />
      <T w={700} s={44} lh={0.92} ls={-0.045} display>{mode === "up" ? "BUILD AN AGENT." : "GET IN."}</T>
      {held ? (
        <Card bg={C.vioBg} pad={14} radius={16}>
          <T w={600} s={14} lh={1.3}>We kept what you were about to do</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ marginTop: 4 }}>{held}. You come straight back after this step.</T>
        </Card>
      ) : null}
      <Touch onPress={() => { if (phase.step === "idle") void run(); }} disabled={phase.step !== "idle"} accessibilityLabel={mode === "up" ? "create-wallet" : "sign-in"}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, backgroundColor: C.ink }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" }}>
          {busy ? <ActivityIndicator color={C.limeOnInk} /> : <Icon name="faceId" size={20} color={C.limeOnInk} />}
        </View>
        <View style={{ flex: 1 }}>
          <T w={600} s={17} lh={1.2} color={C.onInk}>{done ? shortHash(done.address) : busy ? "Waiting on Face ID…" : mode === "up" ? "Create with Face ID" : "Continue with Face ID"}</T>
          <T w={500} s={10} lh={1} ls={0.1} mono color={C.onInkDim} style={{ marginTop: 5 }}>{done ? "MONAD TESTNET" : "PASSKEY · SAME ACCOUNT ON WEB"}</T>
        </View>
        {phase.step === "idle" ? <Icon name="arrow" size={17} color={C.onInk} /> : null}
      </Touch>
      {done ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.limeBg14 }}>
          <Tag color={C.limeInk}>{mode === "up" ? "ACCOUNT CREATED" : "WELCOME BACK"} · {shortHash(done.address).toUpperCase()}</Tag>
        </View>
      ) : null}
      {error ? <T w={400} s={13} lh={1.4} color={C.down}>{error}</T> : null}
      <T w={400} s={13} lh={1.5} color={C.dim}>Reading and following never need an account. Passkey only: no seed phrase, no extension, no password.</T>
      <T w={400} s={12} lh={1.4} color={C.faint}>Connecting is not signing. Every operation is confirmed on its own.</T>
    </Page>
  );
}
