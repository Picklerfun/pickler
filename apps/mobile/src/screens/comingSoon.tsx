import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AppCtx } from "../ctx";
import type { Screen } from "../store";
import { T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";
import { COMING_SOON_COPY, type ComingSoonTab } from "./comingSoonCopy";

export { COMING_SOON_COPY } from "./comingSoonCopy";

const secondaryBtn = { paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;

export function ComingSoonScreen({ screen, requireAccount }: { screen: Screen; requireAccount: AppCtx["requireAccount"] }) {
  const c = COMING_SOON_COPY[screen as ComingSoonTab] ?? COMING_SOON_COPY.market;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: C.surf, borderWidth: 1, borderColor: "rgba(200,240,58,0.35)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={c.icon} size={30} color={C.lime} />
      </View>
      <T w={800} s={22} lh={1.1} ls={-0.03}>{c.title}</T>
      <Tag label="COMING SOON" fg={C.lime} bd="rgba(200,240,58,0.45)" dashed />
      <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", maxWidth: 260 }}>{c.copy}</T>
      <Touch onPress={() => requireAccount("wallet")} style={{ ...secondaryBtn, marginTop: 6 }}>
        <T w={700} s={13.5}>Go to Wallet</T>
      </Touch>
    </View>
  );
}
