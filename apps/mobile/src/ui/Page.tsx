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

/** Una página de react-navigation: cabecera propia (viaja con el gesto), fondo opaco. Con `bare`, el cuerpo es un View flex:1 (para FooterBar fuera del scroll); si no, PageScroll de siempre. */
export function Page({ screen, children, headerRight, bare }: { screen: Screen; children: ReactNode; headerRight?: ReactNode; bare?: boolean }) {
  const ctx = useAppCtx();
  const navigation = useNavigation();
  const { S, perpl, reads, back, setControls } = ctx;
  const openMarket = (perpl.context?.markets ?? []).find((m) => m.id === S.perpsMarketId);
  const perpsSymbol = openMarket?.symbol;
  const agent = screen === "agent" ? reads.agents?.find((a) => a.id === S.agentId) : undefined;
  const [title, baseSub] = headerFor(screen, perpsSymbol, agent);
  // Market: subtítulo dinámico (agentes y apalancamiento máximo del mercado abierto); sin mercado, el de headerFor.
  const sub = screen === "market" && openMarket ? `${reads.agents?.length ?? "—"} AGENTS · MAX ${openMarket.maxLeverage}×` : baseSub;
  const isRoot = ROOT_OF[screen] === screen;
  const canBack = CAN_BACK.includes(screen) && navigation.canGoBack();
  const showTabs = SHOW_TABS.includes(screen);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={showTabs ? ["top"] : ["top", "bottom"]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingHorizontal: 18, paddingBottom: 12, backgroundColor: C.bg }}>
          {canBack ? (
            <Touch onPress={back} accessibilityLabel="back" style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: C.ctl, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={17} color={C.ink} />
            </Touch>
          ) : null}
          {isRoot ? <Image source={require("../../assets/pickler-mark.png")} style={{ width: 26, height: 26 }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            {isRoot
              ? <T w={700} s={30} lh={1} ls={-0.045} display numberOfLines={1}>{title.toUpperCase()}</T>
              : <T w={700} s={22} lh={1.05} ls={-0.03} display numberOfLines={1}>{title.toUpperCase()}</T>}
            {!isRoot && sub ? <T w={500} s={10.5} lh={1.2} ls={0.08} mono color={C.faint} numberOfLines={1} style={{ marginTop: 3 }}>{sub.toUpperCase()}</T> : null}
          </View>
          {headerRight}
          {__DEV__ ? (
            <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
              <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
            </Touch>
          ) : null}
        </View>
        {bare ? <View style={{ flex: 1 }}>{children}</View> : <PageScroll screen={screen}>{children}</PageScroll>}
      </SafeAreaView>
    </View>
  );
}

/** Cuerpo con scroll, pull-to-refresh y sello (UPDATED / COULDN'T REFRESH) — el `Page` de siempre, ahora aparte para que `bare` lo pueda omitir. */
export function PageScroll({ screen, children }: { screen: Screen; children: ReactNode }) {
  const { perpl, treasury, reads, seal } = useAppCtx();
  const insets = useSafeAreaInsets();
  const showTabs = SHOW_TABS.includes(screen);
  const refreshable = REFRESHABLE.includes(screen);

  const [refreshing, setRefreshing] = useState(false);
  // Wallet = saldos + movimientos; Markets/Market = contexto de Perpl (+ reads en Market). allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(
        screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()]
        : screen === "market" || screen === "portfolio" ? [perpl.refreshContext(), reads.refresh()]
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
    <ScrollView
      style={{ flex: 1 }}
      // Las raíces reservan el hueco de la tab bar absoluta (D13); las no-raíz no lo necesitan.
      contentContainerStyle={{ flexGrow: 1, paddingBottom: showTabs ? tabBarHeight(insets.bottom) : 0 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.faint} /> : undefined}
    >
      {failed || label !== null ? (
        <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
          <Tag color={failed ? C.down : C.faint}>{failed ? "COULDN'T REFRESH" : label}</Tag>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

/** Barra de acción fija (Handoff: STICKY ACTION de Market, Read y el perfil). Sólo en pantallas no raíz: ahí no hay tab bar. */
export function FooterBar({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingTop: 12, paddingHorizontal: 18, paddingBottom: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.hair08, gap: 10 }}>
      {children}
    </View>
  );
}

/** Registra una pantalla existente como ruta: recibe el ctx por contexto y lo pasa como props (P2). */
export function withPage(
  screen: Screen,
  Component: (ctx: AppCtx) => ReactElement,
  opts?: { headerRight?: (ctx: AppCtx) => ReactNode; bare?: boolean },
): () => ReactElement {
  const Wrapped = () => {
    const ctx = useAppCtx();
    return <Page screen={screen} headerRight={opts?.headerRight?.(ctx)} bare={opts?.bare}><Component {...ctx} /></Page>;
  };
  Wrapped.displayName = `Page(${screen})`;
  return Wrapped;
}
