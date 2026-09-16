import { Modal, ScrollView, View } from "react-native";
import type { AppCtx } from "./ctx";
import { pill } from "./mock/helpers";
import type { Patch, Phase, Screen } from "./store";
import { Hair, T, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREEN_GROUPS: readonly [string, readonly [Screen, string][]][] = [
  ["Discover", [["market", "Market"], ["search", "Search & filters"], ["agent", "Agent"]]],
  ["Trade", [["trade", "Buy / Sell"], ["signin", "Wallet access"]]],
  ["Follow", [["activity", "Activity"], ["post", "Activity detail"], ["ask", "Ask agent"]]],
  ["Own", [["portfolio", "Portfolio"], ["position", "Position"], ["wallet", "Wallet"], ["deposit", "Deposit"], ["withdraw", "Withdraw"]]],
];

const PHASES: readonly [Phase, string][] = [
  ["quoting", "Quoting"], ["quote", "Quote ready"], ["insufficient", "No balance"], ["expired", "Quote expired"],
  ["confirm", "Confirm"], ["sent", "Processing"], ["done", "Completed"], ["failed", "Failed"], ["unknown", "Unknown"],
];

type Step = { label: string; screen: Screen; patch: Patch };
type Journey = { title: string; note: string; steps: Step[] };
const J = (label: string, screen: Screen, patch: Patch = {}): Step => ({ label, screen, patch });

const JOURNEYS: Journey[] = [
  { title: "New user buys", note: "Agent and amount survive wallet access and a deposit.", steps: [
    J("Market", "market"), J("Agent", "agent", { agentId: "pkl", tab: "token" }),
    J("Buy", "trade", { mode: "buy", phase: "insufficient" }), J("Wallet access", "signin", { resume: true }),
    J("Deposit", "deposit", { resume: true }), J("Quote", "trade", { phase: "quote", resume: true }),
    J("Complete", "trade", { phase: "done" }), J("Position", "position", { mockHolder: true, agentId: "pkl" })] },
  { title: "User with balance buys", note: "The short path. Four taps from market to portfolio.", steps: [
    J("Market", "market"), J("Agent", "agent", { agentId: "pkl", tab: "token" }),
    J("Quote", "trade", { phase: "quote", mode: "buy" }), J("Confirm", "trade", { phase: "confirm" }),
    J("Portfolio", "portfolio", { mockHolder: true })] },
  { title: "User follows activity", note: "Following and asking never require buying.", steps: [
    J("Activity", "activity"), J("Detail", "post", { postId: "p1" }), J("Ask agent", "ask", { agentId: "pkl" }),
    J("Agent", "agent", { agentId: "pkl", tab: "activity" }), J("Buy · optional", "trade", { phase: "quote", mode: "buy" })] },
  { title: "User sells", note: "Ends in the wallet, where the AUSD actually lands.", steps: [
    J("Portfolio", "portfolio", { mockHolder: true }), J("Position", "position", { mockHolder: true, agentId: "pkl" }),
    J("Sell", "trade", { mode: "sell", phase: "quote", mockHolder: true }), J("Confirm", "trade", { mode: "sell", phase: "confirm", mockHolder: true }),
    J("Wallet", "wallet", { mockHolder: true })] },
  { title: "User audits an agent", note: "From a notification to the evidence behind one call.", steps: [
    J("Notification", "activity"), J("The activity", "post", { postId: "p4" }),
    J("Outcome", "post", { postId: "p4" }), J("Track record", "agent", { agentId: "pkl", tab: "activity" })] },
];

function RailLabel({ children, style }: { children: string; style?: { marginBottom?: number } }) {
  return <T w={500} s={10.5} mono color={C.mute} style={[{ marginBottom: 9 }, style]}>{children}</T>;
}

function Chip({ label, on, onLime, onPress }: { label: string; on: boolean; onLime?: boolean; onPress: () => void }) {
  const p = pill(on, onLime ? C.lime : undefined);
  return (
    <Touch onPress={onPress} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg }}>
      <T w={600} s={11.5} color={p.fg}>{label}</T>
    </Touch>
  );
}

export function DevControls({ visible, onClose, ctx }: { visible: boolean; onClose: () => void; ctx: AppCtx }) {
  const { S, set, nav, requireAccount, hasAccount } = ctx;
  const go = (screen: Screen, patch?: Patch) => { requireAccount(screen, patch); onClose(); };
  const holderBtn = (on: boolean, label: string) => {
    const p = pill(S.mockHolder === on);
    return (
      <Touch key={label} onPress={() => set({ mockHolder: on })} style={{ borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 5 }}>
        <T w={600} s={12.5} lh={1.3} color={p.fg}>{label}</T>
      </Touch>
    );
  };
  const kiteOn = pill(S.agentId === "kite");
  const caseOn = pill(S.dataCase !== "normal");
  const nextCase = S.dataCase === "normal" ? "loading" : S.dataCase === "loading" ? "empty" : S.dataCase === "empty" ? "stale" : "normal";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Touch onPress={onClose} style={{ flex: 1 }}><View /></Touch>
        <View style={{ backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.hair, padding: 18, paddingBottom: 28, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <T w={800} s={18} ls={-0.03}>Prototype controls</T>
            <Touch onPress={onClose}><T w={600} s={13} color={C.mute}>Close</T></Touch>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <RailLabel>USER STATE</RailLabel>
            <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginBottom: 9 }}>
              {hasAccount ? "Account and AUSD balance are real. Positions below are example data." : "No account yet: Wallet, Portfolio and Buy will ask for access."}
            </T>
            {holderBtn(false, "Funded · no positions")}
            {holderBtn(true, "Holder · 4,820 PKL example position")}
            <Touch onPress={() => { nav("agent", { agentId: "kite", tab: "activity" }); onClose(); }} style={{ borderWidth: 1, borderColor: kiteOn.bd, backgroundColor: kiteOn.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 5 }}>
              <T w={600} s={12.5} color={kiteOn.fg}>Agent with no history (Kite)</T>
            </Touch>
            <Touch onPress={() => { nav("market", { dataCase: nextCase }); onClose(); }} style={{ borderWidth: 1, borderColor: caseOn.bd, backgroundColor: caseOn.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 }}>
              <T w={600} s={12.5} color={caseOn.fg}>Market: no results / loading / stale (now: {S.dataCase})</T>
            </Touch>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel>SCREENS</RailLabel>
            <View style={{ gap: 11 }}>
              {SCREEN_GROUPS.map(([title, items]) => (
                <View key={title}>
                  <T w={700} s={11} color={C.mute} style={{ marginBottom: 6 }}>{title}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {items.map(([k, label]) => <Chip key={k} label={label} on={S.screen === k} onPress={() => go(k)} />)}
                  </View>
                </View>
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel style={{ marginBottom: 4 }}>TRANSACTION STATES</RailLabel>
            <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginBottom: 9 }}>The nine required states of one shared buy/sell flow.</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {PHASES.map(([k, label]) => (
                <Chip key={k} label={label} on={S.screen === "trade" && S.phase === k} onLime={k === "done"}
                  onPress={() => go("trade", { phase: k, mode: k === "insufficient" ? "buy" : S.mode })} />
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel>THE FIVE JOURNEYS · tap any step</RailLabel>
            <View style={{ gap: 8 }}>
              {JOURNEYS.map((j) => (
                <View key={j.title} style={{ padding: 12, borderWidth: 1, borderColor: C.hair, borderRadius: 12, backgroundColor: C.surf }}>
                  <T w={700} s={13} lh={1.2}>{j.title}</T>
                  <T w={400} s={11.5} lh={1.45} color={C.mute} style={{ marginTop: 3, marginBottom: 8 }}>{j.note}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {j.steps.map((st, i) => (
                      <Touch key={i} onPress={() => go(st.screen, st.patch)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: C.hair, backgroundColor: C.chip }}>
                        <T w={600} s={12}>{st.label}</T>
                      </Touch>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
