import { useNavigation } from "@react-navigation/native";
import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppCtx } from "../ctx";
import { useAppCtx } from "../navigation/context";
import { CAN_BACK, headerFor, REFRESHABLE, ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, T, Tag, Touch } from "./primitives";
import { C } from "./theme";

/** Fondo del teléfono: gradiente + campo de puntos (D10 del hi-fi). Va dentro de cada Page: opaco, tapa la página de abajo durante el gesto (spec mobile-nav D6). */
export function Backdrop() {
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

/** Una página de react-navigation: cabecera propia (viaja con el gesto), ScrollView con pull-to-refresh y sello, fondo opaco. */
export function Page({ screen, children }: { screen: Screen; children: ReactNode }) {
  const ctx = useAppCtx();
  const navigation = useNavigation();
  const { S, perpl, treasury, reads, seal, back, setControls } = ctx;
  const perpsSymbol = (perpl.context?.markets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;
  const [title, sub] = headerFor(screen, perpsSymbol, S.marketTab);
  const isRoot = ROOT_OF[screen] === screen;
  const canBack = CAN_BACK.includes(screen) && navigation.canGoBack();
  const showTabs = SHOW_TABS.includes(screen);
  const refreshable = REFRESHABLE.includes(screen);

  const [refreshing, setRefreshing] = useState(false);
  // Wallet = saldos + movimientos; Markets/Market = contexto de Perpl (+ reads en Market). allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(
        screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()]
        : screen === "market" ? [perpl.refreshContext(), reads.refresh()]
        : [perpl.refreshContext()],
      );
    } finally {
      setRefreshing(false);
      seal.onRefreshDone(screen);
    }
  }, [screen, treasury, perpl, reads, seal]);

  const label = refreshable ? seal.labelFor(screen) : null;
  const failed = refreshable && seal.failedOn(screen);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={showTabs ? ["top"] : ["top", "bottom"]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 9, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair, backgroundColor: C.deep50 }}>
          {canBack ? (
            <Touch onPress={back} accessibilityLabel="back" style={{ width: 31, height: 31, borderRadius: 999, borderWidth: 1, borderColor: C.hair22, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={16} color={C.ink} />
            </Touch>
          ) : null}
          {isRoot ? <Image source={require("../../assets/pickler-mark.png")} style={{ width: 24, height: 24 }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={16.5} lh={1.15} ls={-0.01} display numberOfLines={1}>{title}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} numberOfLines={1} style={{ marginTop: 2 }}>{sub}</T>
          </View>
          {__DEV__ ? (
            <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
              <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
            </Touch>
          ) : null}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
        >
          {failed || label !== null ? (
            <View style={{ paddingHorizontal: 15, paddingTop: 10 }}>
              <Tag color={failed ? C.down : C.faint}>{failed ? "COULDN'T REFRESH" : label}</Tag>
            </View>
          ) : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Registra una pantalla existente como ruta: recibe el ctx por contexto y lo pasa como props (P2). */
export function withPage(screen: Screen, Component: (ctx: AppCtx) => ReactElement): () => ReactElement {
  const Wrapped = () => {
    const ctx = useAppCtx();
    return <Page screen={screen}><Component {...ctx} /></Page>;
  };
  Wrapped.displayName = `Page(${screen})`;
  return Wrapped;
}
