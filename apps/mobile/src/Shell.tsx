import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Image, PanResponder, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AppCtx } from "./ctx";
import { DevControls } from "./DevControls";
import { pill } from "./mock/helpers";
import { ComingSoonScreen } from "./screens/comingSoon";
import { AgentScreen, MarketScreen, SearchScreen } from "./screens/discover";
import { ActivityScreen, AskScreen, PostScreen } from "./screens/follow";
import { DepositScreen, PortfolioScreen, PositionScreen, WalletScreen, WithdrawScreen } from "./screens/own";
import { PerpsScreen } from "./screens/perps";
import { PerpsFundsScreen } from "./screens/perpsFunds";
import { PerpsMarketScreen } from "./screens/perpsMarket";
import { SigninScreen, TradeScreen } from "./screens/trade";
import type { Screen } from "./store";
import { shouldCaptureEdgeSwipe, shouldGoBack } from "./ui/gestures";
import { T, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREENS: Record<Screen, (ctx: AppCtx) => ReactElement> = {
  market: MarketScreen, search: SearchScreen, agent: AgentScreen,
  trade: TradeScreen, signin: SigninScreen,
  activity: ActivityScreen, post: PostScreen, ask: AskScreen,
  portfolio: PortfolioScreen, position: PositionScreen, wallet: WalletScreen,
  deposit: DepositScreen, withdraw: WithdrawScreen,
  perps: PerpsScreen, perpsMarket: PerpsMarketScreen, perpsFunds: PerpsFundsScreen,
};

type TabIcon = "storefront" | "trending-up" | "pulse" | "pie-chart" | "wallet";
const BOTTOM_TABS: readonly [Screen, string, TabIcon][] = [
  ["market", "Market", "storefront"],
  ["perps", "Trade", "trending-up"],
  ["activity", "Activity", "pulse"],
  ["portfolio", "Portfolio", "pie-chart"],
  ["wallet", "Wallet", "wallet"],
];

type HeaderAction = { label: string; active?: boolean; go: () => void };

export function Shell({ ctx }: { ctx: AppCtx }) {
  const { S, set, nav, back, requireAccount, agent, balance, tradeHolds: holds, treasury, perpl } = ctx;
  const [controls, setControls] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const Current = SCREENS[ctx.scr];

  const refreshable = S.screen === "wallet" || S.screen === "perps";
  // D5: Wallet = saldos + movimientos; Trade = markets. allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(S.screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()] : [perpl.refreshContext()]);
    } finally {
      setRefreshing(false);
    }
  }, [S.screen, treasury, perpl]);

  // D7: captura en fase *Capture* para ganarle al ScrollView; sólo desde el borde y sólo horizontal.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => shouldCaptureEdgeSwipe(g.x0, g.dx, g.dy),
    onPanResponderRelease: (_e, g) => { if (shouldGoBack(g.dx)) back(); },
  }), [back]);

  const headerActions: HeaderAction[] = S.screen === "market" && !ctx.comingSoon
    ? [{ label: "★", go: () => nav("search") }, { label: "Alerts", go: () => nav("activity") }]
    : S.screen === "agent"
      ? [{ label: "★", active: S.following, go: () => set({ following: !S.following }) }]
      : [];
  if (__DEV__) headerActions.push({ label: "⚙", go: () => setControls(true) });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.phone }}>
      {/* app header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.hairSoft }}>
        {ctx.canBack ? (
          <Touch onPress={back} style={{ width: 32, height: 32, borderRadius: 999, borderWidth: 1, borderColor: C.hair2, alignItems: "center", justifyContent: "center" }}>
            <T w={500} s={14}>←</T>
          </Touch>
        ) : null}
        {S.screen === "market" ? (
          <Image source={require("../assets/pickler-mark.png")} style={{ width: 26, height: 26 }} resizeMode="contain" />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w={800} s={17} lh={1.15} ls={-0.03} numberOfLines={1}>{ctx.headerTitle}</T>
          <T w={400} s={11.5} lh={1.2} color={C.mute} numberOfLines={1} style={{ marginTop: 2 }}>{ctx.headerSub}</T>
        </View>
        {headerActions.map((a, i) => {
          const p = pill(!!a.active, a.active ? C.lime : undefined);
          return (
            <Touch key={i} onPress={a.go} style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }}>
              <T w={600} s={12} color={p.fg}>{a.label}</T>
            </Touch>
          );
        })}
      </View>

      {/* scroll body */}
      <View style={{ flex: 1 }} {...(ctx.canBack ? pan.panHandlers : {})}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
        >
          {ctx.comingSoon ? <ComingSoonScreen screen={ctx.scr} nav={nav} /> : <Current {...ctx} />}
        </ScrollView>
      </View>

      {/* agent sticky buy bar */}
      {ctx.showAgentBar ? (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: "rgba(11,11,14,0.98)", borderTopWidth: 1, borderTopColor: C.hair }}>
          <Touch onPress={() => requireAccount("trade", { mode: "buy", phase: balance === 0 ? "insufficient" : "quote" })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
            <T w={700} s={14} color={C.onLime}>Buy {agent.tickerBare}</T>
          </Touch>
          <Touch onPress={holds ? () => nav("trade", { mode: "sell", phase: "quote" }) : undefined} disabled={!holds} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: holds ? C.hair2 : "rgba(243,241,236,0.12)", alignItems: "center" }}>
            <T w={700} s={14} color={holds ? C.ink : C.disabled}>Sell</T>
          </Touch>
        </View>
      ) : null}

      {/* bottom tab bar */}
      {ctx.showTabs ? (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.hairSoft, backgroundColor: C.phone, paddingTop: 8, paddingBottom: 6, paddingHorizontal: 6 }}>
          {BOTTOM_TABS.map(([k, label, icon]) => {
            const on = S.screen === k || (k === "portfolio" && S.screen === "position") || (k === "market" && S.screen === "search");
            const fg = on ? C.lime : C.mute;
            return (
              <Touch key={k} onPress={() => requireAccount(k)} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6 }}>
                <Ionicons name={on ? icon : `${icon}-outline`} size={20} color={fg} />
                <T w={600} s={11} color={fg}>{label}</T>
              </Touch>
            );
          })}
        </View>
      ) : null}

      {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
    </SafeAreaView>
  );
}
