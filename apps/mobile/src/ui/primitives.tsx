import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import {
  Activity, ArrowLeft, ArrowRight, ChartLine, CircleQuestionMark, Layers, Rocket, Search, Send, SlidersHorizontal, Wallet,
} from "lucide-react-native";
import Svg, { Polyline } from "react-native-svg";
import { C, textStyle } from "./theme";

// ---------------------------------------------------------------------------
// Texto: w=peso, s=tamaño, lh=ratio, ls=em; mono (JetBrains) | display (Chakra Petch).
export type TProps = {
  w?: number; s?: number; lh?: number; ls?: number; mono?: boolean; display?: boolean; color?: string;
  style?: StyleProp<TextStyle>; numberOfLines?: number; children?: ReactNode; accessibilityLabel?: string;
};

export function T({ w = 400, s = 13, lh, ls, mono, display, color, style, numberOfLines, accessibilityLabel, children }: TProps) {
  return (
    <Text numberOfLines={numberOfLines} accessibilityLabel={accessibilityLabel} style={[textStyle(w, s, { lh, ls, mono, display, color }), style]}>
      {children}
    </Text>
  );
}

/** Línea mono en mayúsculas: `font:500 9.5px/1 mono; letter-spacing:.1em`. */
export function Tag({ children, color = C.faint, s = 9.5, style }: { children: ReactNode; color?: string; s?: number; style?: StyleProp<TextStyle> }) {
  return <T w={500} s={s} lh={1} ls={0.1} mono color={color} style={style}>{children}</T>;
}

export type TouchProps = {
  onPress?: () => void; style?: StyleProp<ViewStyle>; children?: ReactNode; disabled?: boolean;
  hitSlop?: number; accessibilityLabel?: string;
};

export function Touch({ onPress, style, children, disabled, hitSlop, accessibilityLabel }: TouchProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.72 } : null]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Iconos lucide (el diseño usa SVGs enmascarados con estos mismos glifos).
const ICONS = {
  back: ArrowLeft, arrow: ArrowRight, search: Search, send: Send, sliders: SlidersHorizontal, help: CircleQuestionMark,
  chart: ChartLine, rocket: Rocket, activity: Activity, layers: Layers, wallet: Wallet,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 15, color = C.ink, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const Cmp = ICONS[name];
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
}

// ---------------------------------------------------------------------------
// Superficies.
export type CardProps = { children?: ReactNode; style?: StyleProp<ViewStyle>; bd?: string; bg?: string; radius?: number; pad?: number; gap?: number };

/** Superficie estándar: relleno .05 + hairline .14, radio 14. */
export function Card({ children, style, bd = C.hair14, bg = C.card, radius = 14, pad = 13, gap }: CardProps) {
  return (
    <View style={[{ padding: pad, borderRadius: radius, borderWidth: 1, borderColor: bd, backgroundColor: bg, gap }, style]}>
      {children}
    </View>
  );
}

export function TouchCard({ onPress, children, style, bd = C.hair14, bg = C.card, pad = 12, radius = 14, disabled, accessibilityLabel }: TouchProps & { bd?: string; bg?: string; pad?: number; radius?: number }) {
  return (
    <Touch onPress={onPress} disabled={disabled} accessibilityLabel={accessibilityLabel} style={[{ padding: pad, borderRadius: radius, borderWidth: 1, borderColor: bd, backgroundColor: bg }, style]}>
      {children}
    </Touch>
  );
}

/** Fila clave/valor mono: `font:500 10px/1.4 mono; color:#8891B5` con valor ink. */
export function KV({ k, v, vFg = C.ink, kFg = C.faint }: { k: string; v: string; vFg?: string; kFg?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <T w={500} s={10} lh={1.4} mono color={kFg}>{k}</T>
      <T w={500} s={10} lh={1.4} mono color={vFg} style={{ textAlign: "right", flexShrink: 1 }}>{v}</T>
    </View>
  );
}

export type KVRow = { label: string; value: string; fg?: string };

export function KVList({ rows, top, gap = 7, style }: { rows: KVRow[]; top?: boolean; gap?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap, paddingTop: top ? 9 : 0, borderTopWidth: top ? 1 : 0, borderTopColor: C.hair12 }, style]}>
      {rows.map((r, i) => <KV key={i} k={r.label} v={r.value} vFg={r.fg} />)}
    </View>
  );
}

export function Hair({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: C.hair12 }, style]} />;
}

/** Píldora con hairline: filtros, tabs y marcas pequeñas. */
export type ChipProps = {
  label: string; fg?: string; bd?: string; bg?: string; onPress?: () => void; mono?: boolean; dashed?: boolean;
  s?: number; py?: number; px?: number; w?: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
};

export function Chip({ label, fg = C.dim, bd = C.hair18, bg = "transparent", onPress, mono, dashed, s = 11, py = 7, px = 11, w = 600, style, accessibilityLabel }: ChipProps) {
  const inner = <T w={mono ? 500 : w} s={s} lh={1} mono={mono} color={fg}>{label}</T>;
  const box: ViewStyle = {
    paddingVertical: py, paddingHorizontal: px, borderRadius: 999, borderWidth: 1, borderColor: bd, backgroundColor: bg,
    alignItems: "center", justifyContent: "center", borderStyle: dashed ? "dashed" : "solid",
  };
  if (onPress) return <Touch onPress={onPress} accessibilityLabel={accessibilityLabel} style={[box, style]}>{inner}</Touch>;
  return <View style={[box, style]}>{inner}</View>;
}

/** Avatar cuadrado con iniciales: hairline .28, mono bold. */
export function Avatar({ initials, size = 36, radius = 11, s = 11 }: { initials: string; size?: number; radius?: number; s?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, borderWidth: 1, borderColor: C.hair28, alignItems: "center", justifyContent: "center" }}>
      <T w={700} s={s} lh={1} mono color={C.dim}>{initials}</T>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Botones.
export type BtnVariant = "outline" | "outline2" | "outline20" | "lime" | "violet" | "violetSoft" | "violetSoft10" | "violetLine" | "violetLine45" | "ghost" | "dashed";

const VARIANTS: Record<BtnVariant, { bg: string; bd: string; fg: string; w: number }> = {
  outline: { bg: "transparent", bd: C.hair34, fg: C.ink, w: 600 },
  outline2: { bg: "transparent", bd: C.hair2, fg: C.ink, w: 600 },
  outline20: { bg: "transparent", bd: "rgba(245,246,255,0.2)", fg: C.ink, w: 600 },
  lime: { bg: C.lime, bd: C.lime, fg: C.onLime, w: 700 },
  violet: { bg: C.vioSolid, bd: C.vioSolid, fg: C.onDeep, w: 700 },
  violetSoft: { bg: C.vioBg, bd: C.vioBd, fg: C.vio, w: 700 },
  violetSoft10: { bg: C.vioBg10, bd: C.vioBd, fg: C.vio, w: 600 },
  violetLine: { bg: "transparent", bd: C.vioBd, fg: C.vio, w: 600 },
  violetLine45: { bg: "transparent", bd: C.vioBd45, fg: C.vio, w: 600 },
  ghost: { bg: "transparent", bd: "transparent", fg: C.faint, w: 600 },
  dashed: { bg: "transparent", bd: "rgba(245,246,255,0.2)", fg: C.faint, w: 500 },
};

export type BtnProps = {
  label: string; onPress?: () => void; variant?: BtnVariant; arrow?: boolean; icon?: IconName; s?: number; py?: number;
  style?: StyleProp<ViewStyle>; disabled?: boolean; fg?: string; bd?: string; flex?: number; busy?: boolean; accessibilityLabel?: string;
};

/** `busy` muestra el label atenuado (el spinner lo pone la pantalla si quiere); `disabled` baja opacidad. */
export function Btn({ label, onPress, variant = "outline", arrow, icon, s = 12.5, py = 13, style, disabled, fg, bd, flex, busy, accessibilityLabel }: BtnProps) {
  const v = VARIANTS[variant];
  const color = fg ?? v.fg;
  return (
    <Touch
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel}
      style={[{
        flex, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
        paddingVertical: py, paddingHorizontal: 12, borderRadius: variant === "dashed" ? 999 : 12,
        borderWidth: 1, borderColor: bd ?? v.bd, backgroundColor: v.bg,
        borderStyle: variant === "dashed" ? "dashed" : "solid",
        opacity: disabled ? 0.55 : busy ? 0.8 : 1,
      }, style]}
    >
      {icon ? <Icon name={icon} size={15} color={color} /> : null}
      <T w={v.w} s={s} lh={1} mono={variant === "dashed"} color={color}>{label}</T>
      {arrow ? <Icon name="arrow" size={13} color={color} /> : null}
    </Touch>
  );
}

// ---------------------------------------------------------------------------
// Selectores.
export type SegmentedProps<K extends string> = {
  options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void;
  /** Colores del segmento activo por clave (Long lima / Short rosa). Sin `tone`, activo = card10 + ink. */
  tone?: (k: K) => { bg: string; fg: string };
};

/** Control segmentado con pulgar translúcido (tabs de portfolio, buy/sell, long/short). */
export function Segmented<K extends string>({ options, value, onChange, tone }: SegmentedProps<K>) {
  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: C.hair14, backgroundColor: C.deep }}>
      {options.map(([k, label]) => {
        const on = value === k;
        const t = on && tone ? tone(k) : { bg: on ? C.card10 : "transparent", fg: on ? C.ink : C.faint };
        return (
          <Touch key={k} onPress={() => onChange(k)} accessibilityLabel={`segment-${k}`} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 999, backgroundColor: t.bg, alignItems: "center" }}>
            <T w={on ? 700 : 600} s={11.5} lh={1} color={t.fg}>{label}</T>
          </Touch>
        );
      })}
    </View>
  );
}

/** Tabs píldora (tabs de mercado, de agente): lima al seleccionado. */
export function PillTabs<K extends string>({ options, value, onChange, flex = true, style }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; flex?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", gap: 4 }, style]}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <Chip
            key={k} label={label} onPress={() => onChange(k)} accessibilityLabel={`pill-${k}`}
            fg={on ? C.lime : C.dim} bd={on ? C.limeBd : C.hair18} bg={on ? C.limeBg14 : "transparent"}
            s={11.5} py={8} px={flex ? 6 : 12} style={flex ? { flex: 1 } : null}
          />
        );
      })}
    </View>
  );
}

/** Polilínea sobre un viewBox 0..100 con trazo que no escala (Sparkline del prototipo). `points` viene de `sparkPoints`. */
export function Sparkline({ points, stroke = C.spark, style }: { points: readonly (readonly [number, number])[]; stroke?: string; style?: StyleProp<ViewStyle> }) {
  const pts = points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <Svg viewBox="0 0 100 100" preserveAspectRatio="none" style={[{ width: "100%", height: "100%" }, style]}>
      <Polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

/** Par «−»/«+» con el valor mono en medio (hoja de la matriz). `width` fija el ancho; sin él, flex 1. */
export function Stepper({ value, onDown, onUp, width, accessibilityLabel }: { value: string; onDown: () => void; onUp: () => void; width?: number; accessibilityLabel: string }) {
  const btn: ViewStyle = { width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: "rgba(245,246,255,0.2)", alignItems: "center", justifyContent: "center" };
  return (
    <View style={{ flex: width ? 0 : 1, width, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: C.hair }}>
      <Touch onPress={onDown} style={btn} accessibilityLabel={`${accessibilityLabel}-down`}><T w={700} s={13} lh={1}>−</T></Touch>
      <T w={500} s={10} lh={1} mono color={C.dim}>{value}</T>
      <Touch onPress={onUp} style={btn} accessibilityLabel={`${accessibilityLabel}-up`}><T w={700} s={13} lh={1}>+</T></Touch>
    </View>
  );
}

/** Barra de progreso fina (graduación). `pct` en 0..1. */
export function Bar({ pct, h = 5, color = C.blue }: { pct: number; h?: number; color?: string }) {
  return (
    <View style={{ flex: 1, height: h, borderRadius: 999, backgroundColor: C.hair12, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avisos y estados.
export function Warn({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <Card bd={C.warnBd} bg={C.warnBg} pad={11} style={{ paddingHorizontal: 13 }} gap={6}>
      <T w={700} s={12} lh={1.3} color={C.warn}>{title}</T>
      {body ? <T w={400} s={11.5} lh={1.45} color={C.dim}>{body}</T> : null}
      {children}
    </Card>
  );
}

export type Tone = { bd: string; bg: string; fg: string };

/** Tarjeta de estado (fases de read / de orden): borde tintado + tag + título + cuerpo. */
export function StatusCard({ tag, title, body, tone, big, children }: { tag: string; title: string; body?: string; tone: Tone; big?: boolean; children?: ReactNode }) {
  return (
    <Card bd={tone.bd} bg={tone.bg} pad={big ? 15 : 13} gap={big ? 7 : 6}>
      <Tag color={tone.fg}>{tag}</Tag>
      {big
        ? <T w={700} s={20} lh={1.15} ls={-0.02} display>{title}</T>
        : <T w={700} s={13.5} lh={1.3}>{title}</T>}
      {body ? <T w={400} s={11.5} lh={1.45} color={C.dim}>{body}</T> : null}
      {children}
    </Card>
  );
}

export function Page({ children, style, gap = 11, top = 14 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; top?: number }) {
  return <View style={[{ paddingTop: top, paddingHorizontal: 15, paddingBottom: 20, gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Conservadas de la app (no existen en el diseño), re-vestidas.
export type StatItem = { label: string; value: string; fg?: string };

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.hair14, borderRadius: 14, overflow: "hidden" }}>
      {items.map((it, i) => (
        <View key={i} style={{ width: "50%", backgroundColor: C.card, padding: 12, paddingHorizontal: 13, borderColor: C.hair12, borderTopWidth: i >= 2 ? 1 : 0, borderLeftWidth: i % 2 === 1 ? 1 : 0 }}>
          <Tag>{it.label.toUpperCase()}</Tag>
          <T w={500} s={13} mono color={it.fg ?? C.ink} style={{ marginTop: 6 }}>{it.value}</T>
        </View>
      ))}
    </View>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <View style={{ padding: 26, paddingHorizontal: 18, borderWidth: 1, borderColor: "rgba(245,246,255,0.24)", borderStyle: "dashed", borderRadius: 14, alignItems: "center" }}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeletons (spec mobile-loading D1/D4). Un solo pulso compartido: `PULSE` vive en el módulo y el loop
// arranca con el primer skeleton montado y se detiene con el último (refcount), aunque haya 20 bloques.
const PULSE = new Animated.Value(1);
let pulseLoop: Animated.CompositeAnimation | null = null;
let pulseMounted = 0;

function usePulse(): Animated.Value {
  useEffect(() => {
    if (pulseMounted++ === 0) {
      pulseLoop = Animated.loop(Animated.sequence([
        Animated.timing(PULSE, { toValue: 0.45, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(PULSE, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      pulseLoop.start();
    }
    return () => {
      if (--pulseMounted === 0) { pulseLoop?.stop(); pulseLoop = null; PULSE.setValue(1); }
    };
  }, []);
  return PULSE;
}

type SkeletonProps = { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> };

function SkeletonBlock({ w = "100%", h = 12, r = 8, style }: SkeletonProps) {
  const opacity = usePulse();
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.hair, opacity }, style]} />;
}

/** Una línea de texto de tamaño `s` (alto ≈ 1.1·s). */
function SkeletonLine({ s = 13, w = "60%" }: { s?: number; w?: number | `${number}%` }) {
  return <SkeletonBlock h={Math.round(s * 1.1)} w={w} r={6} />;
}

/** Card con `lines` líneas; `big` pone la primera a 30 px (una cifra grande, como los saldos). */
function SkeletonCard({ lines = 2, big }: { lines?: number; big?: boolean }) {
  const widths: (number | `${number}%`)[] = ["45%", "70%", "55%", "62%"];
  return (
    <Card pad={big ? 15 : 13} gap={9}>
      {Array.from({ length: lines }, (_, i) => <SkeletonBlock key={i} h={i === 0 && big ? 30 : 12} w={widths[i % widths.length]} />)}
    </Card>
  );
}

/** Fila de lista: título + subtítulo a la izquierda, valor + variación a la derecha (como `MarketsList`). */
function SkeletonRow() {
  return (
    <Card pad={13} style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBlock h={14} w="30%" />
        <SkeletonBlock h={11} w="55%" />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <SkeletonBlock h={13} w={72} />
        <SkeletonBlock h={10} w={44} />
      </View>
    </Card>
  );
}

export const Skeleton = Object.assign(SkeletonBlock, { Line: SkeletonLine, Card: SkeletonCard, Row: SkeletonRow });

/** El contenido entra con un fade de 150 ms al montarse (skeleton → dato). Nada más (D4). */
export function Reveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start(); }, [opacity]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}
