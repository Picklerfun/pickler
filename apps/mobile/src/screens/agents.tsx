import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { recordLabel } from "../reads/matrix";
import { Avatar, Chip, T, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

/** Pill Agents (D15): lista de agentes con récord real; tocar uno lo preselecciona en Ask. */
export function AgentsTab({ reads, set }: AppCtx) {
  return (
    <View style={{ paddingTop: 13, paddingHorizontal: 15, paddingBottom: 20, gap: 7 }}>
      {reads.agentsError ? (
        <Warn title="Couldn't load agents" body={reads.agentsError}>
          <Chip label="Retry" onPress={() => { void reads.refresh(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agents" />
        </Warn>
      ) : null}
      {reads.agents === null && !reads.agentsError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading agents…</T> : null}
      {(reads.agents ?? []).map((a) => (
        <TouchCard key={a.id} onPress={() => set({ askAgentId: a.id, marketTab: "ask", askView: "new" })} accessibilityLabel={`agent-row-${a.id}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Avatar initials={a.name.slice(0, 1).toUpperCase()} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={14} lh={1.2}>{a.name}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} style={{ marginTop: 3 }}>by {a.owner}</T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <T w={500} s={10.5} lh={1} mono color={C.dim}>{recordLabel(a.record)}</T>
            <T w={500} s={10} lh={1} mono color={C.faint}>{a.priceCredits} credit</T>
          </View>
        </TouchCard>
      ))}
    </View>
  );
}
