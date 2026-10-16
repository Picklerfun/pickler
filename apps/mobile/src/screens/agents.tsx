import { View } from "react-native";
import { adviceAmount } from "../advice/copy";
import type { AppCtx } from "../ctx";
import { agentBlurb, hitRate, initials } from "../reads/agentsCopy";
import type { Agent } from "../reads/types";
import { askMarketId } from "../store";
import { Avatar, Btn, Chip, EmptyPanel, Page, Reveal, Skeleton, T, Tag, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

/**
 * Studio agents (plan 2026-10-12-studio-agents-app, Task 4): the marketplace agents that sell a 24-hour analysis for AUSD.
 * Its own loading, error and empty states; the row opens the advice screen, gated like the profile.
 */
function StudioSection({ studio, requireAccount }: Pick<AppCtx, "studio" | "requireAccount">) {
  const open = (id: string) => requireAccount("advice", { adviceAgentId: id });
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 4 }}>
        <T w={700} s={22} ls={-0.04} display>STUDIO AGENTS</T>
        <T w={500} s={10.5} mono color={C.faint}>24H ANALYSIS · BTC OR ETH · PAID IN AUSD</T>
      </View>
      {studio.agentsError && studio.agents === null ? (
        <Warn title="Couldn't load Studio agents" body={studio.agentsError}>
          <Chip label="Retry" onPress={() => { void studio.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-studio-agents" />
        </Warn>
      ) : null}
      {studio.agents === null && !studio.agentsError ? <><Skeleton.Card lines={2} /><Skeleton.Card lines={2} /></> : null}
      {studio.agents !== null && studio.agents.length === 0 ? (
        <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No Studio agents sell analyses yet.</T></EmptyPanel>
      ) : null}
      {studio.agents !== null && studio.agents.length > 0 ? (
        <Reveal style={{ gap: 10 }}>
          {studio.agents.map((a) => (
            <TouchCard key={a.id} onPress={() => open(a.id)} accessibilityLabel={`studio-agent-${a.id}`} style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar initials={initials(a.name)} size={44} s={13} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T w={600} s={18} lh={1.15}>{a.name}</T>
                  <T w={500} s={10} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>@{a.handle.toUpperCase()}</T>
                </View>
              </View>
              <Btn label={`Ask · ${adviceAmount(a.price.micro)} AUSD`} icon="ask" onPress={() => open(a.id)} variant="ask" py={12} accessibilityLabel={`studio-ask-${a.id}`} />
            </TouchCard>
          ))}
        </Reveal>
      ) : null}
      {studio.nextCursor ? <Chip label="Load more agents" onPress={() => { void studio.loadMore(); }} accessibilityLabel="load-more-studio-agents" /> : null}
      <View style={{ height: 6 }} />
    </View>
  );
}

/** Pestaña Agents (D15): lista pública de agents-list. La tarjeta abre el perfil; "Ask" abre Market en Ask con el agente (D13). */
export function AgentsScreen({ reads, perpl, S, requireAccount, identity, studio }: AppCtx) {
  // Agents es pública, Market no (D23): requireAccount desvía a Sign in y vuelve con el patch.
  const ask = (a: Agent) => requireAccount("market", { askAgentId: a.id, marketTab: "ask", perpsMarketId: askMarketId(S.perpsMarketId, perpl.context?.markets ?? []) });
  return (
    <Page gap={12}>
      {identity.studioAgents ? <StudioSection studio={studio} requireAccount={requireAccount} /> : null}
      {reads.agentsError ? (
        <Warn title="Couldn't load agents" body={reads.agentsError}>
          <Chip label="Retry" onPress={() => { void reads.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agents" />
        </Warn>
      ) : null}
      {reads.agents === null && !reads.agentsError ? <><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /></> : null}
      {reads.agents !== null && reads.agents.length === 0 ? (
        <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No agents yet.</T></EmptyPanel>
      ) : null}
      {reads.agents !== null && reads.agents.length > 0 ? (
        <Reveal style={{ gap: 10 }}>
          {reads.agents.map((a) => (
            <TouchCard key={a.id} onPress={() => requireAccount("agent", { agentId: a.id })} accessibilityLabel={`agent-row-${a.id}`} style={{ gap: 12 }}>
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
