import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { agentBlurb, hitRate } from "../reads/agentsCopy";
import type { Agent } from "../reads/types";
import { askMarketId } from "../store";
import { Avatar, Btn, Chip, Page, Reveal, Skeleton, T, Tag, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

const initials = (name: string): string => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Pestaña Agents (D15): lista pública de agents-list. En F1 la tarjeta y "Ask" abren Market en Ask con el agente (D13). */
export function AgentsScreen({ reads, perpl, S, requireAccount }: AppCtx) {
  // Agents es pública, Market no (D23): requireAccount desvía a Sign in y vuelve con el patch.
  const ask = (a: Agent) => requireAccount("market", { askAgentId: a.id, marketTab: "ask", perpsMarketId: askMarketId(S.perpsMarketId, perpl.context?.markets ?? []) });
  return (
    <Page gap={12}>
      {reads.agentsError ? (
        <Warn title="Couldn't load agents" body={reads.agentsError}>
          <Chip label="Retry" onPress={() => { void reads.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agents" />
        </Warn>
      ) : null}
      {reads.agents === null && !reads.agentsError ? <><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /></> : null}
      {reads.agents !== null ? (
        <Reveal style={{ gap: 10 }}>
          {reads.agents.map((a) => (
            <TouchCard key={a.id} onPress={() => ask(a)} accessibilityLabel={`agent-row-${a.id}`} style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar initials={initials(a.name)} size={44} s={13} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T w={600} s={18} lh={1.15}>{a.name}</T>
                  <T w={500} s={10} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>BY {a.owner.toUpperCase()}</T>
                </View>
              </View>
              <T w={400} s={14.5} lh={1.4} color={C.dim}>{agentBlurb(a.id)}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.bg }}>
                  <Tag>HIT · {a.record.resolved} RESOLVED</Tag>
                  <T w={700} s={19} mono style={{ marginTop: 6 }}>{hitRate(a.record)}</T>
                </View>
                <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.bg }}>
                  <Tag>BRIER · LOWER IS BETTER</Tag>
                  <T w={700} s={19} mono style={{ marginTop: 6 }}>{a.record.brierAvg === null ? "—" : a.record.brierAvg.toFixed(2)}</T>
                </View>
              </View>
              <Btn label={`Ask · ${a.priceCredits} credit${a.priceCredits === 1 ? "" : "s"}`} icon="ask" onPress={() => ask(a)} variant="ask" py={12} accessibilityLabel={`ask-agent-${a.id}`} />
            </TouchCard>
          ))}
        </Reveal>
      ) : null}
    </Page>
  );
}
