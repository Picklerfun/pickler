import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppCtx } from "./ctx";
import { DevControls } from "./DevControls";
import { ComingSoonScreen } from "./screens/comingSoon";
import { MarketScreen } from "./screens/market";
import { MarketsScreen } from "./screens/markets";
import { PerpsFundsScreen } from "./screens/perpsFunds";
import { SigninScreen } from "./screens/signin";
import { DepositScreen, WalletScreen, WithdrawScreen } from "./screens/wallet";
import { ROOT_OF, refreshOk, screenHasData, type Screen, updatedLabel } from "./store";
import { shouldCaptureEdgeSwipe, shouldGoBack } from "./ui/gestures";
import { Icon, type IconName, T, Tag, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREENS: Record<Screen, (ctx: AppCtx) => ReactElement> = {
  markets: MarketsScreen, market: MarketScreen, perpsFunds: PerpsFundsScreen,
  launchpad: (ctx) => <ComingSoonScreen screen="launchpad" requireAccount={ctx.requireAccount} />,
  activity: (ctx) => <ComingSoonScreen screen="activity" requireAccount={ctx.requireAccount} />,
  portfolio: (ctx) => <ComingSoonScreen screen="portfolio" requireAccount={ctx.requireAccount} />,
  wallet: WalletScreen, deposit: DepositScreen, withdraw: WithdrawScreen, signin: SigninScreen,
};

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Fondo del teléfono: gradiente + campo de puntos, como el marco del diseño (D10). */
function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[C.bgTop, C.bgMid, C.bgBottom]} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}>
        <Defs>
          <Pattern id="dots" patternUnits="userSpaceOnUse" width="130" height="130">
            <Circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.7)" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dots)" />
      </Svg>
    </View>
  );
}

export function Shell({ ctx }: { ctx: AppCtx }) {
  const { S, back, requireAccount, treasury, perpl, reads } = ctx;
  const [controls, setControls] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Sello del pull-to-refresh (spec mobile-loading D5): por pantalla; la carga inicial también lo fija (P5 del plan F1).
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Screen, number>>>({});
  const [refreshDone, setRefreshDone] = useState(0); // se incrementa al terminar cada jalón; el efecto de abajo lo evalúa con el estado ya actualizado (P4)
  const [refreshFailed, setRefreshFailed] = useState<Screen | null>(null); // pantalla cuyo jalón falló (D5: el sello es por pantalla, no global)
  const Current = SCREENS[ctx.scr];

  const refreshable = S.screen === "wallet" || S.screen === "markets" || S.screen === "market";
  // Wallet = saldos + movimientos; Markets/Market = contexto de Perpl (+ reads en Market). allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(
        S.screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()]
        : S.screen === "market" ? [perpl.refreshContext(), reads.refresh()]
        : [perpl.refreshContext()],
      );
    } finally {
      setRefreshing(false);
      setRefreshDone((n) => n + 1);
    }
  }, [S.screen, treasury, perpl, reads]);

  const errors = { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.listError };
  // Evalúa el jalón que acaba de terminar con los errores de ESTE render (tras el await el estado puede no estar aplicado).
  useEffect(() => {
    if (refreshDone === 0) return;
    if (refreshOk(S.screen, errors)) { setUpdatedAt((u) => ({ ...u, [S.screen]: Date.now() })); setRefreshFailed(null); return; }
    setRefreshFailed(S.screen);
    const t = setTimeout(() => setRefreshFailed(null), 3000);
    return () => clearTimeout(t);
  }, [refreshDone]);
  // Sello inicial: la primera vez que la pantalla tiene su dato principal.
  const hasData = screenHasData(S.screen, { balances: treasury.balances, context: perpl.context });
  useEffect(() => {
    if (!refreshable || !hasData || updatedAt[S.screen] !== undefined) return;
    setUpdatedAt((u) => ({ ...u, [S.screen]: Date.now() }));
  }, [refreshable, hasData, S.screen, updatedAt]);
  const failed = refreshFailed === S.screen;

  // Captura en fase *Capture* para ganarle al ScrollView; sólo desde el borde y sólo horizontal.
  const pan = useMemo(() => PanResponder.create({
    // g.x0 sólo vale a partir de onResponderGrant; en capture siempre es 0, así que la x inicial real es moveX - dx.
    onMoveShouldSetPanResponderCapture: (_e, g) => shouldCaptureEdgeSwipe(g.moveX - g.dx, g.dx, g.dy),
    onPanResponderRelease: (_e, g) => { if (shouldGoBack(g.dx)) back(); },
  }), [back]);

  const isRoot = ROOT_OF[S.screen] === S.screen;

  // Una sola ScrollView sirve a todas las pantallas: sin esto, entrar a Market desde
  // una lista ya scrolleada hereda el offset y el ticket abre a media página.
  const body = useRef<ScrollView>(null);
  useEffect(() => { body.current?.scrollTo({ y: 0, animated: false }); }, [S.screen]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 9, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair, backgroundColor: C.deep50 }}>
          {ctx.canBack ? (
            <Touch onPress={back} accessibilityLabel="back" style={{ width: 31, height: 31, borderRadius: 999, borderWidth: 1, borderColor: C.hair22, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={16} color={C.ink} />
            </Touch>
          ) : null}
          {isRoot ? <Image source={require("../assets/pickler-mark.png")} style={{ width: 24, height: 24 }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={16.5} lh={1.15} ls={-0.01} display numberOfLines={1}>{ctx.headerTitle}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} numberOfLines={1} style={{ marginTop: 2 }}>{ctx.headerSub}</T>
          </View>
          {__DEV__ ? (
            <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
              <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
            </Touch>
          ) : null}
        </View>

        {/* cuerpo */}
        <View style={{ flex: 1 }} {...(ctx.canBack ? pan.panHandlers : {})}>
          <ScrollView
            ref={body}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
          >
            {refreshable && (failed || updatedAt[S.screen] !== undefined) ? (
              <View style={{ paddingHorizontal: 15, paddingTop: 10 }}>
                <Tag color={failed ? C.down : C.faint}>{failed ? "COULDN'T REFRESH" : updatedLabel(updatedAt[S.screen]!)}</Tag>
              </View>
            ) : null}
            <Current {...ctx} />
          </ScrollView>
        </View>

        {/* tab bar */}
        {ctx.showTabs ? (
          <View style={{ flexDirection: "row", paddingTop: 8, paddingHorizontal: 6, paddingBottom: 12, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.deep50 }}>
            {TABS.map(([k, label, icon]) => {
              const fg = ROOT_OF[S.screen] === k ? C.lime : C.faint;
              return (
                <Touch key={k} onPress={() => requireAccount(k)} accessibilityLabel={`tab-${k}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
                  <Icon name={icon} size={19} color={fg} />
                  <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
                </Touch>
              );
            })}
          </View>
        ) : null}
      </SafeAreaView>

      {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
    </View>
  );
}
