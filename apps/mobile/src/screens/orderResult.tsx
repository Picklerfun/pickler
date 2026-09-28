import { ActivityIndicator, View } from "react-native";
import { Btn, StatusCard, T, type Tone } from "../ui/primitives";
import { C } from "../ui/theme";

export type OrderResult =
  | { step: "sent" }
  | { step: "filled"; title: string; detail: string; note?: string }
  | { step: "failed"; text: string }
  | { step: "unknown" };

/** Tonos de D14: sent = hair2/slab, filled = lima, failed = down, unknown = warn. */
const TONES = {
  sent: { tag: "SENT", title: "Order accepted — waiting for the fill", tone: { bd: C.hair2, bg: C.slab, fg: C.dim } },
  filled: { tag: "FILLED", title: "Filled", tone: { bd: C.limeBd, bg: C.limeBg06, fg: C.limeInk } },
  failed: { tag: "FAILED", title: "Order failed", tone: { bd: C.downBd, bg: C.downBg, fg: C.down } },
  unknown: { tag: "NO CONFIRMATION", title: "No confirmation yet", tone: { bd: C.warnBd, bg: C.warnBg, fg: C.warn } },
} as const satisfies Record<OrderResult["step"], { tag: string; title: string; tone: Tone }>;

/**
 * Estados Sent / Filled / Failed / Unknown, compartidos por apertura (market.tsx) y cierre (tradingGate.tsx).
 * Vive aparte para que market.tsx y tradingGate.tsx no se importen entre sí (Require cycle, trampa de mobile-nav).
 */
export function OrderResultCard({ result, primary, onEdit }: { result: OrderResult; primary: { label: string; onPress: () => void }; onEdit?: () => void }) {
  const t = TONES[result.step];
  const body = result.step === "filled" ? result.detail
    : result.step === "failed" ? result.text
    : result.step === "unknown" ? "Check your positions — the order may still have gone through."
    : undefined;
  return (
    <View style={{ gap: 11 }}>
      <StatusCard tag={t.tag} title={result.step === "filled" ? result.title : t.title} body={body} tone={t.tone}>
        {result.step === "sent" ? <ActivityIndicator color={C.dim} style={{ alignSelf: "flex-start" }} /> : null}
        {result.step === "filled" && result.note ? <T w={400} s={11.5} lh={1.4} color={C.dim} accessibilityLabel="order-note">{result.note}</T> : null}
      </StatusCard>
      {result.step !== "sent" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {result.step === "failed" && onEdit ? <Btn label="Edit" onPress={onEdit} variant="outline" flex={1} accessibilityLabel="edit-order" /> : null}
          <Btn label={primary.label} onPress={primary.onPress} variant="lime" flex={1} accessibilityLabel="back-to-markets" />
        </View>
      ) : null}
    </View>
  );
}
