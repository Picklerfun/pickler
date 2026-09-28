import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useAppCtx } from "../navigation/context";
import { type TabName, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { pillWidth, pillX, ROW_BOTTOM, ROW_H, ROW_PAD_X, ROW_TOP, TAB_COUNT, tabBarHeight, tabIndexAt } from "./tabBarLayout";
import { C } from "./theme";

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Resorte de la pastilla: rigidez media, sin rebote exagerado (P5 del plan F2). */
const SPRING = { damping: 18, stiffness: 220, mass: 0.6 };
const HIDE_MS = 220;

/**
 * Tab bar custom de bottom-tabs (spec mobile-nav D11/D13). Siempre montada y absoluta: se esconde deslizando
 * hacia abajo cuando la pantalla enfocada no es raíz (D13). La pastilla lima sigue a `state.index` con resorte y
 * se puede arrastrar sin despegar el dedo; la pestaña cambia sólo al soltar (D11). El tap sigue siendo tap.
 * Fondo opaco (`C.bg`): al ser absoluta el contenido pasa por debajo y sin blur nativo un fondo translúcido
 * dejaba leer el texto entre los iconos (F2-R2).
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { switchTab } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  const visible = SHOW_TABS.includes(focusedScreen);
  const height = tabBarHeight(insets.bottom);
  const activeIndex = state.index;

  // Ancho real de la fila (depende del dispositivo, P2): estado para React y sharedValue para los worklets.
  const [width, setWidth] = useState(0);
  const rowW = useSharedValue(0);

  // Pastilla: x animada; `drag` = índice bajo el dedo durante el arrastre (−1 = sin arrastre).
  const pill = useSharedValue(0);
  const drag = useSharedValue(-1);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // Primer layout: coloca la pastilla sin resorte; el efecto de abajo sólo anima cambios de índice.
    if (rowW.value === 0) pill.value = pillX(activeIndex, w);
    rowW.value = w;
    setWidth(w);
  }, [rowW, pill, activeIndex]);
  useEffect(() => { if (width > 0) pill.value = withSpring(pillX(state.index, width), SPRING); }, [state.index, width, pill]);

  // Esconder/mostrar (D13): translateY = alto de la barra.
  const ty = useSharedValue(visible ? 0 : height);
  useEffect(() => { ty.value = withTiming(visible ? 0 : height, { duration: HIDE_MS }); }, [visible, height, ty]);

  const select = useCallback((i: number) => {
    const route = state.routes[i];
    // El listener `tabPress` de native-stack es quien hace popToTop en la pila anidada al tocar la pestaña ya
    // enfocada; aquí siempre se emite (D11) y, si nadie lo previene y es otra pestaña, se cambia (paridad con el tap).
    const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (i !== state.index && !e.defaultPrevented) switchTab(route.name as TabName);
  }, [state.index, state.routes, navigation, switchTab]);
  const tick = useCallback(() => { void Haptics.selectionAsync(); }, []);

  // Gesto memoizado: gesture-handler no necesita recrearlo en cada render (residual #3 del audit F2).
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible && width > 0)
        .activeOffsetX([-6, 6]) // el tap no se roba: el Pan sólo activa con 6 pt horizontales
        .failOffsetY([-12, 12])
        .onStart((e) => {
          const i = tabIndexAt(e.x, rowW.value, TAB_COUNT);
          drag.value = i;
          pill.value = withSpring(pillX(i, rowW.value, TAB_COUNT), SPRING);
        })
        .onUpdate((e) => {
          const i = tabIndexAt(e.x, rowW.value, TAB_COUNT);
          if (i !== drag.value) {
            drag.value = i;
            pill.value = withSpring(pillX(i, rowW.value, TAB_COUNT), SPRING);
            scheduleOnRN(tick);
          }
        })
        // `onEnd` también corre al cancelar (success=false) si el Pan estaba activo: sólo se selecciona al soltar de verdad.
        .onEnd((_e, success) => { if (success) scheduleOnRN(select, drag.value); })
        .onFinalize((_e, success) => {
          // Un Pan que nunca activó (tap) no movió la pastilla y no debe tocarla (evita bamboleo en doble tap).
          if (!success && drag.value !== -1) pill.value = withSpring(pillX(activeIndex, rowW.value, TAB_COUNT), SPRING);
          drag.value = -1;
        }),
    [visible, width, activeIndex, select, tick, rowW, pill, drag]
  );

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pill.value }] }));

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height, paddingTop: ROW_TOP, paddingBottom: insets.bottom + ROW_BOTTOM, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.bg }, barStyle]}
    >
      <GestureDetector gesture={pan}>
        <View onLayout={onLayout} style={{ flexDirection: "row", height: ROW_H, paddingHorizontal: ROW_PAD_X }}>
          {width > 0 ? (
            <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, width: pillWidth(width), height: ROW_H, borderRadius: 999, backgroundColor: C.limeBg14 }, pillStyle]} />
          ) : null}
          {state.routes.map((route, i) => {
            const root = TAB_ROOT[route.name as TabName];
            const [, label, icon] = TABS.find(([k]) => k === root)!;
            const fg = ROOT_OF[focusedScreen] === root ? C.limeInk : C.faint;
            return (
              <Touch key={route.key} onPress={() => select(i)} accessibilityLabel={`tab-${root}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
                <Icon name={icon} size={19} color={fg} />
                <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
              </Touch>
            );
          })}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}
