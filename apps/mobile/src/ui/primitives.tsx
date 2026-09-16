import type { ReactNode } from "react";
import { Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import { C, textStyle } from "./theme";

export type TProps = {
  w?: number;
  s?: number;
  lh?: number;
  ls?: number;
  mono?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children?: ReactNode;
};

/** Texto con el shorthand `font:` del wireframe: w=peso, s=tamaño, lh=ratio, ls=em. */
export function T({ w = 400, s = 13, lh, ls, mono, color, style, numberOfLines, children }: TProps) {
  return (
    <Text numberOfLines={numberOfLines} style={[textStyle(w, s, { lh, ls, mono, color }), style]}>
      {children}
    </Text>
  );
}

export type TouchProps = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  disabled?: boolean;
};

export function Touch({ onPress, style, children, disabled }: TouchProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.72 } : null]}
    >
      {children}
    </Pressable>
  );
}

export type TagProps = {
  label: string;
  fg?: string;
  bd?: string;
  bg?: string;
  dashed?: boolean;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: number;
};

export function Tag({ label, fg = C.mute, bd = C.hair, bg = "transparent", dashed, dot, style, size = 10.5 }: TagProps) {
  return (
    <View
      style={[
        {
          flexDirection: "row", alignItems: "center", gap: 6,
          paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999,
          borderWidth: 1, borderColor: bd, backgroundColor: bg,
          borderStyle: dashed ? "dashed" : "solid",
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: fg }} /> : null}
      <T w={600} s={size} color={fg}>{label}</T>
    </View>
  );
}

export function Hair({ color = C.hairSoft, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: color }, style]} />;
}

export type StatItem = { label: string; value: string; fg?: string };

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.hairSoft, borderRadius: 14, overflow: "hidden" }}>
      {items.map((it, i) => (
        <View
          key={i}
          style={{
            width: "50%", backgroundColor: C.surf, padding: 12, paddingHorizontal: 13,
            borderColor: C.hairSoft,
            borderTopWidth: i >= 2 ? 1 : 0,
            borderLeftWidth: i % 2 === 1 ? 1 : 0,
          }}
        >
          <T w={400} s={11} color={C.mute}>{it.label}</T>
          <T w={500} s={13.5} mono color={it.fg ?? C.ink} style={{ marginTop: 5 }}>{it.value}</T>
        </View>
      ))}
    </View>
  );
}

export function KV({ label, value, fg = C.ink, top = true }: { label: string; value: string; fg?: string; top?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline",
        borderTopWidth: top ? 1 : 0, borderTopColor: "rgba(243,241,236,0.08)", paddingTop: top ? 8 : 0,
      }}
    >
      <T w={400} s={12.5} lh={1.3} color={C.dim} style={{ flex: 1 }}>{label}</T>
      <T w={500} s={12.5} lh={1.3} mono color={fg} style={{ textAlign: "right" }}>{value}</T>
    </View>
  );
}

export function Avatar({ initial, size = 38, radius = 11, fontSize = 14 }: { initial: string; size?: number; radius?: number; fontSize?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: radius, backgroundColor: C.tile,
        borderWidth: 1, borderColor: C.hair, alignItems: "center", justifyContent: "center",
      }}
    >
      <T w={800} s={fontSize} color={C.dim}>{initial}</T>
    </View>
  );
}

export type SegmentOption = {
  label: string;
  bg: string;
  fg: string;
  onPress?: () => void;
  disabled?: boolean;
  strong?: boolean;
};

export function Segmented({ options }: { options: SegmentOption[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: C.hair, backgroundColor: C.surf2 }}>
      {options.map((o, i) => (
        <Touch
          key={i}
          onPress={o.onPress}
          disabled={o.disabled}
          style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 999, backgroundColor: o.bg, alignItems: "center" }}
        >
          <T w={o.strong ? 700 : 600} s={o.strong ? 13 : 12.5} color={o.fg}>{o.label}</T>
        </Touch>
      ))}
    </View>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <View style={{ padding: 26, paddingHorizontal: 18, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", borderRadius: 16, alignItems: "center" }}>
      {children}
    </View>
  );
}

export function TouchCard({ onPress, children, style }: TouchProps) {
  return (
    <Touch onPress={onPress} style={[{ borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, padding: 13, paddingHorizontal: 14 }, style]}>
      {children}
    </Touch>
  );
}
