import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { isComingSoonTab, type Screen } from "../store";
import { Btn, Card, Chip, Icon, T, Tag } from "../ui/primitives";
import { C } from "../ui/theme";
import { COMING_SOON_COPY, MARKET_COMING_SOON } from "./comingSoonCopy";

export { COMING_SOON_COPY } from "./comingSoonCopy";

/** Pantalla completa de los tabs sin función (D17). */
export function ComingSoonScreen({ screen, requireAccount }: { screen: Screen; requireAccount: AppCtx["requireAccount"] }) {
  if (!isComingSoonTab(screen)) throw new Error(`ComingSoonScreen: ${screen} is not a coming-soon tab`);
  const c = COMING_SOON_COPY[screen];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.vioBd40, alignItems: "center", justifyContent: "center" }}>
        <Icon name={c.icon} size={30} color={C.vio} />
      </View>
      <T w={700} s={22} lh={1.1} ls={-0.02} display>{c.title}</T>
      <Chip label="COMING SOON" mono s={10} fg={C.lime} bd={C.limeBd} dashed />
      <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", maxWidth: 260 }}>{c.copy}</T>
      <Btn label="Go to Wallet" onPress={() => requireAccount("wallet")} variant="outline" py={14} style={{ marginTop: 6, paddingHorizontal: 22 }} accessibilityLabel="go-to-wallet" />
    </View>
  );
}

/** Tarjeta inline para los pills Ask y Agents de Market (D14). */
export function ComingSoonCard({ which }: { which: "ask" | "agents" }) {
  const c = MARKET_COMING_SOON[which];
  return (
    <Card bd={C.vioBd40} bg={C.vioBg06} gap={8}>
      <Tag color={C.vio}>COMING SOON</Tag>
      <T w={700} s={14} lh={1.3}>{c.title}</T>
      <T w={400} s={11.5} lh={1.45} color={C.dim}>{c.copy}</T>
    </Card>
  );
}
