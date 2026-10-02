import { useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Linking, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shortHash } from "../config/chain";
import type { IdentityApi } from "../hooks/useIdentity";
import { claimable, HANDLE_MAX, HANDLE_MIN, handleNote, handleState, normalizeHandle } from "../identity/handle";
import { Btn, Chip, Hair, T, Tag, Touch } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";

const SETTLE_MS = 350; // quieto este tiempo antes de consultar: escribir un nombre no es una petición por tecla
const LINK_URL = "https://pickler.fun";

/**
 * El username, obligatorio: tapa la app mientras la cuenta de la wallet no tenga uno. Es el último paso de entrar, igual
 * que en la web («Pickler Connect Link Wallet»): elegirlo, o —si la persona ya tiene cuenta bajo su wallet de navegador—
 * vincular esta wallet a esa cuenta, que se hace en pickler.fun porque aquí sólo vive el passkey. La única otra salida
 * es cerrar sesión.
 */
export function UsernameGate({ identity, address, onSignOut }: { identity: IdentityApi; address: string; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const [handle, setHandle] = useState("");
  // La respuesta se guarda con el handle por el que se preguntó: una que llega tarde no se muestra contra otro nombre.
  const [answer, setAnswer] = useState<{ asked: string; available: boolean | null } | null>(null);
  const [linking, setLinking] = useState(false);
  const normalized = normalizeHandle(handle);
  const state = handleState(handle, answer && answer.asked === normalized ? answer.available : undefined);
  const { check } = identity;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (state !== "checking") return;
    const timer = setTimeout(() => {
      void check(normalized).then((available) => { if (alive.current) setAnswer({ asked: normalized, available }); });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [state, normalized, check]);

  // Al volver del navegador con el panel de vincular abierto, la app comprueba sola: quien ya vinculó entra sin tocar nada.
  const { recheck } = identity;
  useEffect(() => {
    if (!linking) return;
    const sub = AppState.addEventListener("change", (next) => { if (next === "active") void recheck({ quiet: true }); });
    return () => sub.remove();
  }, [linking, recheck]);

  const show = (next: boolean) => { identity.clearError(); setLinking(next); };
  const ok = state === "ok";
  const bad = state === "taken" || state === "invalid_characters" || state === "too_long" || state === "reserved";
  const noteFg = ok ? C.limeInk : bad ? C.down : C.faint;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: C.bg }}
      accessibilityViewIsModal
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18, paddingHorizontal: 18, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Tag s={10.5}>{linking ? "ACCOUNT · LINK TO YOUR ACCOUNT" : "ACCOUNT · PICK YOUR USERNAME"}</Tag>
          <Chip label="Sign out" onPress={onSignOut} accessibilityLabel="username-sign-out" />
        </View>

        {linking ? (
          <>
            <T w={700} s={40} lh={0.95} ls={-0.04} display>LINK TO YOUR ACCOUNT.</T>
            <T w={500} s={14} lh={1.5} color={C.dim}>
              Your account is under a browser wallet, and a browser wallet signs in a browser. Open pickler.fun, connect with this same passkey, and choose “Link this wallet to it”. Then come back.
            </T>
            <Btn label="Open pickler.fun" variant="ink" arrow onPress={() => { void Linking.openURL(LINK_URL); }} accessibilityLabel="username-open-web" />
            <Btn label={identity.busy ? "Checking…" : "I linked it — check again"} variant="outline" busy={identity.busy} onPress={() => { void identity.recheck(); }} accessibilityLabel="username-recheck" />
            {identity.error ? <T w={600} s={12.5} lh={1.4} color={C.down}>{identity.error}</T> : null}
            <View style={{ flex: 1 }} />
            <Hair />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Touch onPress={() => show(false)} accessibilityLabel="username-back" hitSlop={10}>
                <T w={600} s={12.5} color={C.dim}>← Back</T>
              </Touch>
              <Tag s={10.5}>LINKING {shortHash(address).toUpperCase()}</Tag>
            </View>
          </>
        ) : (
          <>
            <T w={700} s={40} lh={0.95} ls={-0.04} display>PICK YOUR USERNAME.</T>
            <T w={500} s={14} lh={1.5} color={C.dim}>How you show up on the board. Letters, numbers, underscore — {HANDLE_MIN} to {HANDLE_MAX}.</T>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.ctl, borderWidth: 1, borderColor: ok ? C.limeBd : bad ? C.down : C.ctl }}>
                <T w={600} s={17} color={ok ? C.limeInk : C.faint}>@</T>
                <TextInput
                  value={handle}
                  onChangeText={(v) => setHandle(v.replace(/^@/, "").slice(0, HANDLE_MAX))}
                  placeholder="username"
                  placeholderTextColor={C.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => { if (claimable(state) && !identity.busy) void identity.claim(handle); }}
                  accessibilityLabel="username-input"
                  style={[textStyle(600, 17, { color: C.ink }), { flex: 1, paddingVertical: 16 }]}
                />
              </View>
              <Tag s={10.5} color={noteFg} style={{ paddingHorizontal: 16 }}>{handleNote(state, handle)}</Tag>
            </View>
            <Btn
              label={identity.busy ? "Claiming…" : "Claim it"}
              variant={claimable(state) ? "lime" : "outline"}
              arrow={!identity.busy}
              disabled={!claimable(state)}
              busy={identity.busy}
              onPress={() => { void identity.claim(handle); }}
              accessibilityLabel="username-claim"
            />
            {identity.error ? <T w={600} s={12.5} lh={1.4} color={C.down}>{identity.error}</T> : null}
            <Touch onPress={() => show(true)} accessibilityLabel="username-link" hitSlop={8} style={{ alignSelf: "center", paddingVertical: 6 }}>
              <T w={500} s={12.5} lh={1.4} color={C.dim}>Already have a Pickler account? <T w={600} s={12.5} color={C.ink}>Link this wallet to it</T></T>
            </Touch>
            <View style={{ flex: 1 }} />
            <Hair />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Tag s={10.5}>CONNECTED</Tag>
              <Tag s={10.5} color={C.dim}>{shortHash(address).toUpperCase()} · PASSKEY WALLET</Tag>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
