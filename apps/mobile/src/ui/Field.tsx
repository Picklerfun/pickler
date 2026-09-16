import { StyleSheet, Text, View } from "react-native";
import { palette, spacing } from "./theme";

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: palette.card, padding: spacing.md, borderRadius: 12, gap: spacing.xs },
  label: { color: palette.muted, fontSize: 13 },
  value: { color: palette.text, fontSize: 22, fontVariant: ["tabular-nums"] },
});
