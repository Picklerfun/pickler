import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAppCtx } from "../navigation/context";
import { type TabName, TAB_ORDER, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight } from "./tabBarLayout";
import { C, TAB_TINT } from "./theme";

/** Pestañas visibles del Handoff (D2): clave, etiqueta mono, icono lucide. Iconos del Handoff (grid · user · chart · wallet); D1 del spec quedó corregido. */
export const TABS: Record<"markets" | "agents" | "portfolio" | "wallet", [string, IconName]> = {
  markets: ["MARKETS", "grid"],
  agents: ["AGENTS", "user"],
  portfolio: ["PORTFOLIO", "chart"],
  wallet: ["WALLET", "wallet"],
};
const HIDE_MS = 220;

/**
 * Tab bar custom de bottom-tabs: 4 botones fijos (Launchpad y Activity están registradas pero no se pintan, D1).
 * Activo = fondo de control + tinte de la pestaña; se esconde deslizando en pantallas no raíz (mobile-nav D13).
 * Fondo blanco al 96 % sin blur (D2: sin expo-blur) y hairline arriba.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { switchTab } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  const visible = SHOW_TABS.includes(focusedScreen);
  const height = tabBarHeight(insets.bottom);
  const ty = useSharedValue(visible ? 0 : height);
  useEffect(() => { ty.value = withTiming(visible ? 0 : height, { duration: HIDE_MS }); }, [visible, height, ty]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  const select = (name: TabName) => {
    const route = state.routes.find((r) => r.name === name)!;
    const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (route.key !== focusedTab.key && !e.defaultPrevented) switchTab(name);
  };

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height, paddingTop: ROW_TOP, paddingBottom: insets.bottom + ROW_BOTTOM, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.hair08, backgroundColor: "rgba(255,255,255,0.96)" }, barStyle]}
    >
      <View style={{ flexDirection: "row", height: ROW_H, gap: 4 }}>
        {TAB_ORDER.map((name) => {
          const root = TAB_ROOT[name] as keyof typeof TABS;
          const [label, icon] = TABS[root];
          const on = ROOT_OF[focusedScreen] === root;
          const fg = on ? TAB_TINT[root] : C.faint;
          return (
            <Touch key={name} onPress={() => select(name)} accessibilityLabel={`tab-${root}`}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 16, backgroundColor: on ? C.ctl : "transparent" }}>
              <Icon name={icon} size={19} color={fg} />
              <T w={500} s={10.5} lh={1} ls={0.06} mono color={fg}>{label}</T>
            </Touch>
          );
        })}
      </View>
    </Animated.View>
  );
}
