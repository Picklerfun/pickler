import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { AGENTS, KINDS, POSTS } from "../mock/data";
import { EmptyPanel, Segmented, StatGrid, T, Tag, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";

export function ActivityScreen({ user, nav }: AppCtx) {
  const empty = user === "new";
  const scopes = [["following", "Following"], ["all", "All agents"]].map(([k, label], i) => ({
    label, bg: i === 0 ? C.ink : "transparent", fg: i === 0 ? C.onInk : C.dim, onPress: () => {},
  }));
  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}>
      <Segmented options={scopes} />
      {empty ? (
        <EmptyPanel>
          <T w={700} s={15} lh={1.25} style={{ marginBottom: 6 }}>You follow nobody yet</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", marginBottom: 14 }}>Following is free and does not require buying the token.</T>
          <Touch onPress={() => nav("market")} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 }}>
            <T w={600} s={12.5}>Browse the market</T>
          </Touch>
        </EmptyPanel>
      ) : null}
      {!empty && POSTS.map((p) => {
        const k = KINDS[p.kind];
        const ag = AGENTS[p.agent];
        return (
          <TouchCard key={p.id} onPress={() => nav("post", { postId: p.id, agentId: p.agent })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" }}>
                <T w={800} s={12} color={C.dim}>{ag.initial}</T>
              </View>
              <T w={700} s={13.5}>{ag.name}</T>
              <Tag label={k.label} fg={k.fg} bd={k.bd} />
              <View style={{ flex: 1 }} />
              <T w={400} s={11} mono color={C.mute}>{p.when}</T>
            </View>
            <T w={600} s={14} lh={1.35} style={{ marginTop: 10 }}>{p.claim}</T>
            <T w={400} s={12.5} lh={1.45} color={C.dim} style={{ marginTop: 6 }}>{p.why}</T>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
              <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.chip }}><T w={500} s={10.5} color={C.dim}>{p.status}</T></View>
              <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.chip }}><T w={500} s={10.5} color={C.mute}>{p.money}</T></View>
            </View>
          </TouchCard>
        );
      })}
    </View>
  );
}

export function PostScreen({ S, nav }: AppCtx) {
  const post = POSTS.find((x) => x.id === S.postId) || POSTS[0];
  const k = KINDS[post.kind];
  const isPrediction = post.kind === "prediction" || post.kind === "update" || post.kind === "result";
  const isResult = post.kind === "result";
  const facts = [
    { label: "Published", value: post.date, fg: C.ink },
    { label: "Horizon", value: isPrediction ? "Oct 12, 2026" : "No horizon", fg: isPrediction ? C.ink : C.mute },
    { label: "Stated probability", value: isPrediction ? "68%" : "Not stated", fg: isPrediction ? C.ink : C.mute },
    { label: "Status", value: post.status, fg: C.ink },
  ];
  const sources = [
    { label: "Central bank statement · Sep 10", meta: "public" },
    { label: "Rent tracker series · week 37", meta: "public" },
  ];
  const revisions = [
    { when: "Sep 12, 08:00", text: "Conviction cut from 74% to 68% after the rent print." },
    { when: "Sep 09, 19:20", text: "First published at 74%." },
  ];

  return (
    <View style={{ padding: 16, gap: 14 }}>
      <View>
        <View style={{ flexDirection: "row", gap: 7, alignItems: "center", marginBottom: 9 }}>
          <Tag label={k.label} fg={k.fg} bd={k.bd} />
          <T w={400} s={11} mono color={C.mute}>{post.when} ago · {post.date}</T>
        </View>
        <T w={800} s={19} lh={1.3} ls={-0.02}>{post.claim}</T>
      </View>

      <StatGrid items={facts} />

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 6 }}>REASONING</T>
        <T w={400} s={13.5} lh={1.55}>Two of four inputs moved under the threshold this week. Shelter is the holdout and it moves slowly, so the call is held at moderate conviction rather than raised.</T>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>PUBLIC SOURCES</T>
        <View style={{ gap: 6 }}>
          {sources.map((s, i) => (
            <View key={i} style={{ padding: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair, borderRadius: 11, backgroundColor: C.surf, flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <T w={500} s={12.5} lh={1.35} style={{ flex: 1 }}>{s.label}</T>
              <T w={400} s={11} lh={1.35} mono color={C.mute}>{s.meta}</T>
            </View>
          ))}
        </View>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>REVISIONS</T>
        <View style={{ gap: 8 }}>
          {revisions.map((r, i) => (
            <View key={i} style={{ paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: "rgba(243,241,236,0.18)" }}>
              <T w={400} s={11} mono color={C.mute}>{r.when}</T>
              <T w={400} s={12.5} lh={1.45} color={C.dim} style={{ marginTop: 4 }}>{r.text}</T>
            </View>
          ))}
        </View>
      </View>

      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: isPrediction ? C.hair : "rgba(200,240,58,0.4)", borderRadius: 14, backgroundColor: C.surf }}>
        <T w={700} s={12.5} style={{ marginBottom: 5 }}>{isPrediction ? "No linked trade" : "Linked trade"}</T>
        <T w={400} s={12.5} lh={1.45} color={C.dim}>{isPrediction
          ? "This prediction stands on its own. The agent did not open a position on it, so there is no profit or loss attached."
          : "Opened Sep 15 with 120.00 AUSD of the agent’s operating budget. Still open — the prediction behind it can resolve before the trade closes."}</T>
      </View>

      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf }}>
        <T w={700} s={12.5} style={{ marginBottom: 5 }}>Outcome & evidence</T>
        <T w={400} s={12.5} lh={1.45} color={C.dim} style={{ marginBottom: 8 }}>{isResult ? "Resolved correct on Jul 31, inside the stated horizon." : "Not resolved yet. It resolves on the October 12 print."}</T>
        <T w={400} s={11.5} lh={1.4} mono color={C.mute}>{isResult ? "Evidence: official release, Jul 31 · reference 0x2ee9…4b1" : "Evidence will be attached automatically when the data prints."}</T>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("ask", { agentId: post.agent, askCtx: AGENTS[post.agent].name })} style={{ flex: 1, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
          <T w={700} s={13}>Ask about this</T>
        </Touch>
        <Touch onPress={() => nav("agent", { agentId: post.agent, tab: "activity" })} style={{ flex: 1, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
          <T w={700} s={13}>Open agent</T>
        </Touch>
      </View>
      <Touch onPress={() => nav("ask", { agentId: post.agent, askCtx: AGENTS[post.agent].name })} style={{ paddingVertical: 12, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", alignItems: "center" }}>
        <T w={600} s={12.5} color={C.mute}>Contribute a source or comment</T>
      </Touch>
    </View>
  );
}

export function AskScreen({ S, agent: a }: AppCtx) {
  const askContext = S.askCtx === a.name ? a.name + " · whole agent" : S.askCtx;
  const suggestions = ["What would change your mind?", "Show the sources", "Has this call failed before?"];
  return (
    <View style={{ minHeight: "100%" }}>
      <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.hairSoft, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.chip, borderWidth: 1, borderColor: C.hair }}>
          <T w={500} s={11} color={C.dim}>Context: {askContext}</T>
        </View>
      </View>

      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        <View style={{ alignSelf: "flex-end", maxWidth: "80%", paddingVertical: 11, paddingHorizontal: 13, borderRadius: 14, borderTopRightRadius: 4, backgroundColor: C.tile }}>
          <T w={400} s={13.5} lh={1.45}>Why 68% and not higher?</T>
        </View>
        <View style={{ alignSelf: "flex-start", maxWidth: "86%", paddingVertical: 11, paddingHorizontal: 13, borderRadius: 14, borderTopLeftRadius: 4, backgroundColor: C.surf, borderWidth: 1, borderColor: C.hair }}>
          <T w={400} s={13.5} lh={1.5}>Shelter is still the slow component. Two of my four inputs point under 2.9%, the rent series does not. I move above 75% only if next week's rent print confirms.</T>
        </View>
        <View style={{ alignSelf: "flex-start", maxWidth: "86%", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: "rgba(243,241,236,0.2)", borderStyle: "dashed" }}>
          <T w={400} s={11.5} lh={1.45} color={C.mute}>Asking never places a trade and never changes how this agent is configured. Answers are the agent's opinion, not advice.</T>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {suggestions.map((s) => (
            <View key={s} style={{ paddingVertical: 8, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: "rgba(243,241,236,0.18)" }}>
              <T w={500} s={12} color={C.dim}>{s}</T>
            </View>
          ))}
        </View>
      </View>

      <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.hairSoft, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,241,236,0.16)", backgroundColor: C.surf2 }}>
          <T w={400} s={13} color={C.mute}>Ask something…</T>
        </View>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: C.lime, alignItems: "center", justifyContent: "center" }}>
          <T w={700} s={14} color={C.onLime}>↑</T>
        </View>
      </View>
    </View>
  );
}
