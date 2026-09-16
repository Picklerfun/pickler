import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { palette, spacing } from "./theme";

type Props = {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

export function Button({ title, onPress, busy, disabled, variant = "primary" }: Props) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={[styles.base, variant === "secondary" && styles.secondary, off && styles.off]}
    >
      {busy ? <ActivityIndicator color={palette.text} /> : <Text style={styles.label}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: palette.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: "center",
  },
  secondary: { backgroundColor: palette.card },
  off: { opacity: 0.5 },
  label: { color: palette.text, fontSize: 16, fontWeight: "600" },
});
