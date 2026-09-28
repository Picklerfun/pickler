import { useNavigation } from "@react-navigation/native";
import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { Image, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppCtx } from "../ctx";
import { useAppCtx } from "../navigation/context";
import { CAN_BACK, headerFor, REFRESHABLE, ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, T, Tag, Touch } from "./primitives";
import { tabBarHeight } from "./tabBarLayout";
import { C } from "./theme";

/** Una página de react-navigation: cabecera propia (viaja con el gesto), ScrollView con pull-to-refresh y sello, fondo opaco. */
export function Page({ screen, children }: { screen: Screen; children: ReactNode }) {
  const ctx = useAppCtx();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
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
          // Las raíces reservan el hueco de la tab bar absoluta (D13); las no-raíz no lo necesitan.
          contentContainerStyle={{ flexGrow: 1, paddingBottom: showTabs ? tabBarHeight(insets.bottom) : 0 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.limeInk} /> : undefined}
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
