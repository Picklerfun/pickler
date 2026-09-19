import { Modal, ScrollView, View } from "react-native";
import type { AppCtx } from "./ctx";
import type { Screen } from "./store";
import { Chip, Hair, T, Tag, Touch } from "./ui/primitives";
import { C, pill } from "./ui/theme";

const GROUPS: readonly [string, readonly [Screen, string][]][] = [
  ["Perpl", [["markets", "Markets"], ["market", "Market · ticket"], ["perpsFunds", "Trading funds"]]],
  ["Wallet", [["wallet", "Wallet"], ["deposit", "Deposit"], ["withdraw", "Withdraw"], ["signin", "Wallet access"]]],
  ["Coming soon", [["launchpad", "Launchpad"], ["activity", "Activity"], ["portfolio", "Portfolio"]]],
];

function PChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const p = pill(on);
  return <Chip label={label} fg={p.fg} bd={p.bd} bg={p.bg} onPress={onPress} s={11.5} py={6} px={10} accessibilityLabel={`dev-${label.toLowerCase().replace(/\W+/g, "-")}`} />;
}

export function DevControls({ visible, onClose, ctx }: { visible: boolean; onClose: () => void; ctx: AppCtx }) {
  const { S, requireAccount, hasAccount, account, perpl, lock, signOut, signedOut } = ctx;
  const firstMarket = perpl.context?.markets[0]?.id;
  const go = (screen: Screen) => {
    requireAccount(screen, screen === "market" && firstMarket !== undefined ? { perpsMarketId: firstMarket, perpsSide: "long" } : undefined);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Touch onPress={onClose} style={{ flex: 1 }}><View /></Touch>
        <View style={{ backgroundColor: C.bgMid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.hair, padding: 18, paddingBottom: 28, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <T w={700} s={18} ls={-0.01} display>Dev controls</T>
            <Touch onPress={onClose} accessibilityLabel="dev-close"><T w={600} s={13} color={C.faint}>Close</T></Touch>
          </View>
          <T w={500} s={10} lh={1.4} mono color={C.faint} style={{ marginBottom: 14 }}>
            screen: {S.screen} · account: {account.status} · perpl: {perpl.state.status} · skew: {perpl.clockSkewMs === null ? "—" : `${Math.round(perpl.clockSkewMs / 1000)}s`}
          </T>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Tag s={10} style={{ marginBottom: 9 }}>SCREENS</Tag>
            <View style={{ gap: 11 }}>
              {GROUPS.map(([title, items]) => (
                <View key={title}>
                  <T w={700} s={11} color={C.faint} style={{ marginBottom: 6 }}>{title}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {items.map(([k, label]) => <PChip key={k} label={label} on={S.screen === k} onPress={() => go(k)} />)}
                  </View>
                </View>
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <Tag s={10} style={{ marginBottom: 9 }}>SESSION</Tag>
            <T w={400} s={11.5} lh={1.4} color={C.faint} style={{ marginBottom: 9 }}>
              {hasAccount ? "Account, balances and Perpl are real; nothing here is mocked." : "No account yet: gated screens will ask for access."}
            </T>
            <View style={{ flexDirection: "row", gap: 5 }}>
              {account.status === "unlocked" ? <PChip label="Lock" on={false} onPress={() => { lock(); onClose(); }} /> : null}
              {hasAccount ? <PChip label="Sign out" on={false} onPress={() => { void signOut().then(() => { signedOut(); onClose(); }); }} /> : null}
              <PChip label="Clock +2 min" on={perpl.clockSkewMs !== null && perpl.clockSkewMs >= 120_000} onPress={() => perpl.setClockSkewOverride(perpl.clockSkewMs !== null && perpl.clockSkewMs >= 120_000 ? null : 120_000)} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
