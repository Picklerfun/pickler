import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { View } from "react-native";
import { useAppCtx } from "../navigation/context";
import { type TabName, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { C } from "./theme";

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Tab bar custom de bottom-tabs. Oculta en pantallas no raíz (SHOW_TABS, P4); el ítem activo sale de `state.index`. */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { switchTab } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  if (!SHOW_TABS.includes(focusedScreen)) return null;
  return (
    <View style={{ flexDirection: "row", paddingTop: 8, paddingHorizontal: 6, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.deep50 }}>
      {state.routes.map((route, i) => {
        const root = TAB_ROOT[route.name as TabName];
        const [, label, icon] = TABS.find(([k]) => k === root)!;
        const focused = state.index === i;
        const fg = ROOT_OF[focusedScreen] === root ? C.lime : C.faint;
        const onPress = () => {
          // tabPress es lo que hace popToTop en la pila anidada cuando la pestaña ya está enfocada (doc bottom-tabs).
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) switchTab(route.name as TabName);
        };
        return (
          <Touch key={route.key} onPress={onPress} accessibilityLabel={`tab-${root}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
            <Icon name={icon} size={19} color={fg} />
            <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
          </Touch>
        );
      })}
    </View>
  );
}
