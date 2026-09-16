import { ScrollView, View } from "react-native";
import type { AppCtx } from "../ctx";
import { AGENTS, type Agent, KINDS, POSTS, type Stage } from "../mock/data";
import { pill } from "../mock/helpers";
import type { Sort } from "../store";
import { Avatar, EmptyPanel, Segmented, StatGrid, T, Tag, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";

const SORT_NOTES: Record<Sort, string> = {
  trending: "Trending ranks token activity in the last 24h. It is not a ranking of strategy quality.",
  volume: "Volume ranks AUSD traded in 24h. Nothing here judges the agent.",
  new: "Newest first. A new agent has no track record to read yet.",
};

const stageStyle = (stage: Stage) => ({
  bd: stage === "Pre-grad" ? "rgba(122,92,255,0.55)" : C.blueBd,
  fg: stage === "Pre-grad" ? C.violetInk : C.blue,
});

export function MarketScreen({ S, set, nav }: AppCtx) {
  const ready = S.dataCase === "normal" || S.dataCase === "stale";
  const sorts = (["trending", "volume", "new"] as const).map((k) => {
    const on = S.sort === k;
    return {
      label: k === "new" ? "New" : k[0].toUpperCase() + k.slice(1),
      bg: on ? C.ink : "transparent", fg: on ? C.onInk : C.dim,
      onPress: () => set({ sort: k }),
    };
  });
  const chips = [
    { label: "★ Favourites" }, { label: "Specialty ▾" }, { label: "Stage ▾" }, { label: "Active only" },
  ];

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 12 }}>
      <Touch onPress={() => nav("search")} style={{
        flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 14,
        borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,241,236,0.16)", backgroundColor: C.surf2,
      }}>
        <T w={500} s={13} mono color={C.mute}>⌕</T>
        <T w={400} s={14} color={C.mute}>Search name or ticker</T>
      </Touch>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {chips.map((c, i) => (
          <Touch key={i} onPress={() => nav("search")} style={{
            paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999,
            borderWidth: 1, borderColor: C.hair2, backgroundColor: "transparent",
          }}>
            <T w={600} s={12.5} color={C.dim}>{c.label}</T>
          </Touch>
        ))}
      </ScrollView>

      <View>
        <Segmented options={sorts} />
        <T w={400} s={11.5} lh={1.35} color={C.mute} style={{ marginTop: 7, marginHorizontal: 2 }}>{SORT_NOTES[S.sort]}</T>
      </View>

      {S.dataCase === "loading" ? (
        <View style={{ gap: 8 }}>
          {[1, 2, 3, 4].map((k) => (
            <View key={k} style={{ padding: 14, borderWidth: 1, borderColor: C.hairFaint, borderRadius: 14, backgroundColor: C.surf, flexDirection: "row", gap: 11, alignItems: "center" }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.tile }} />
              <View style={{ flex: 1, gap: 7 }}>
                <View style={{ height: 11, width: "54%", borderRadius: 4, backgroundColor: C.tile }} />
                <View style={{ height: 9, width: "78%", borderRadius: 4, backgroundColor: C.chip }} />
              </View>
            </View>
          ))}
          <T w={400} s={12} lh={1.4} color={C.mute} style={{ margin: 2 }}>Loading agents…</T>
        </View>
      ) : null}

      {S.dataCase === "empty" ? (
        <EmptyPanel>
          <T w={700} s={15} lh={1.25} style={{ marginBottom: 6 }}>No agents match “semis”</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ marginBottom: 14, textAlign: "center" }}>Two filters are on: Equities and Pre-grad.</T>
          <Touch onPress={() => set({ dataCase: "normal" })} style={{ paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 }}>
            <T w={600} s={12.5}>Clear filters</T>
          </Touch>
        </EmptyPanel>
      ) : null}

      {S.dataCase === "stale" ? (
        <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4} color={C.warn}>Prices are not updating</T>
          <T w={400} s={12} lh={1.4} color="#D8C79A" style={{ marginTop: 3 }}>Showing the last values received, 4m ago. Trading is paused until the feed returns.</T>
        </View>
      ) : null}

      {ready ? (
        <View style={{ gap: 8 }}>
          {Object.values(AGENTS).map((a) => {
            const ss = stageStyle(a.stage);
            return (
              <TouchCard key={a.id} onPress={() => nav("agent", { agentId: a.id, tab: "token" })}>
                <View style={{ flexDirection: "row", gap: 11, alignItems: "flex-start" }}>
                  <Avatar initial={a.initial} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
                      <T w={700} s={15} lh={1.2}>{a.name}</T>
                      <T w={500} s={11.5} mono color={C.mute}>{a.ticker}</T>
                    </View>
                    <T w={400} s={12.5} lh={1.35} color={C.dim} style={{ marginTop: 3 }}>{a.what}</T>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                      <Tag label={a.stage} fg={ss.fg} bd={ss.bd} />
                      <Tag label={a.signal} fg={C.mute} bd="rgba(243,241,236,0.16)" size={10.5} />
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <T w={500} s={13.5} lh={1.2} mono>{a.price}</T>
                    <T w={500} s={11.5} lh={1.2} mono color={a.up ? C.up : C.down} style={{ marginTop: 3 }}>{a.change}</T>
                    <T w={400} s={10} lh={1.2} color={C.mute} style={{ marginTop: 2 }}>24h · AUSD</T>
                  </View>
                </View>
              </TouchCard>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function SearchScreen({ set, nav }: AppCtx) {
  const specialties = ["Macro & rates", "Equities", "Energy", "Crypto", "Elections", "Sports"];
  const stages = ["All", "Pre-grad", "Post-grad"];
  const recents = [
    { label: "pickle", meta: "$PKL" }, { label: "macro", meta: "7 agents" }, { label: "kite", meta: "$KITE" },
  ];
  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.lime, backgroundColor: C.surf2 }}>
        <T w={500} s={13} mono color={C.lime}>⌕</T>
        <T w={400} s={14}>semis</T>
        <View style={{ flex: 1 }} />
        <Touch onPress={() => nav("market")}><T w={400} s={12} color={C.mute}>Cancel</T></Touch>
      </View>

      <View>
        <T w={700} s={12.5} color={C.mute} style={{ marginBottom: 8 }}>Specialty</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {specialties.map((l, i) => {
            const p = pill(i === 1);
            return (
              <Touch key={l} onPress={() => set({ dataCase: "empty" })} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg }}>
                <T w={600} s={12.5} color={p.fg}>{l}</T>
              </Touch>
            );
          })}
        </View>
      </View>

      <View>
        <T w={700} s={12.5} color={C.mute} style={{ marginBottom: 8 }}>Launch stage</T>
        <Segmented options={stages.map((l, i) => ({
          label: l, bg: i === 1 ? C.ink : "transparent", fg: i === 1 ? C.onInk : C.dim, onPress: () => set({ dataCase: "empty" }),
        }))} />
        <T w={400} s={11.5} lh={1.35} color={C.mute} style={{ marginTop: 7, marginHorizontal: 2 }}>Stage says where the token trades. It says nothing about how the agent performs.</T>
      </View>

      <View>
        <T w={700} s={12.5} color={C.mute} style={{ marginBottom: 8 }}>Recent</T>
        <View>
          {recents.map((r) => (
            <Touch key={r.label} onPress={() => nav("agent", { agentId: "pkl" })} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: C.hairFaint }}>
              <T w={500} s={13.5}>{r.label}</T>
              <T w={400} s={11.5} mono color={C.mute}>{r.meta}</T>
            </Touch>
          ))}
        </View>
      </View>

      <Touch onPress={() => nav("market", { dataCase: "normal" })} style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" }}>
        <T w={700} s={14.5} color={C.onLime}>Show 12 agents</T>
      </Touch>
    </View>
  );
}

export function AgentScreen(ctx: AppCtx) {
  const { S, set, nav, agent: a, tradeHolds } = ctx;
  const ss = stageStyle(a.stage);
  const opFg = a.op === "Active" ? C.up : a.op === "Paused" ? C.warn : C.down;
  const opBd = a.op === "Active" ? "rgba(123,227,138,0.45)" : a.op === "Paused" ? "rgba(245,195,91,0.45)" : "rgba(242,119,122,0.45)";
  const hasPosition = tradeHolds && a.id === "pkl";

  const tabs = [["token", "Token"], ["activity", "Activity"], ["about", "About"]] as const;

  return (
    <View>
      <View style={{ padding: 16, paddingBottom: 0, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <Avatar initial={a.initial} size={52} radius={15} fontSize={19} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <T w={800} s={20} lh={1.1} ls={-0.03}>{a.name}</T>
              <T w={500} s={12.5} mono color={C.mute}>{a.ticker}</T>
            </View>
            <T w={400} s={13} lh={1.45} color={C.dim} style={{ marginTop: 5 }}>{a.bio}</T>
            <T w={400} s={12} color={C.mute} style={{ marginTop: 6 }}>Built by {a.creator}</T>
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Tag label={a.op} fg={opFg} bd={opBd} dot size={11.5} />
          <Tag label={a.stage} fg={ss.fg} bd={ss.bd} size={11.5} />
          <Tag label="Two separate things" fg={C.mute} bd="rgba(243,241,236,0.2)" dashed size={11.5} />
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => set({ following: !S.following })} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: C.hair2, backgroundColor: S.following ? C.chip : "transparent", alignItems: "center" }}>
            <T w={700} s={13}>{S.following ? "Following" : "Follow"}</T>
          </Touch>
          <Touch onPress={() => nav("ask", { askCtx: a.name })} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
            <T w={700} s={13}>Ask {a.name}</T>
          </Touch>
        </View>
      </View>

      <View style={{ marginTop: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.hairSoft, backgroundColor: C.phone }}>
        <View style={{ flexDirection: "row", gap: 18 }}>
          {tabs.map(([k, label]) => {
            const on = S.tab === k;
            return (
              <Touch key={k} onPress={() => set({ tab: k })} style={{ paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: on ? C.lime : "transparent" }}>
                <T w={700} s={13.5} color={on ? C.ink : C.mute}>{label}</T>
              </Touch>
            );
          })}
        </View>
      </View>

      {S.tab === "token" ? <AgentToken ctx={ctx} a={a} hasPosition={hasPosition} /> : null}
      {S.tab === "activity" ? <AgentActivity ctx={ctx} a={a} /> : null}
      {S.tab === "about" ? (
        <View style={{ padding: 16, gap: 14 }}>
          {a.about.map((b) => (
            <View key={b.label}>
              <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 5 }}>{b.label}</T>
              <T w={400} s={13.5} lh={1.5}>{b.value}</T>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ height: 22 }} />
    </View>
  );
}

function AgentToken({ ctx, a, hasPosition }: { ctx: AppCtx; a: Agent; hasPosition: boolean }) {
  const { nav } = ctx;
  return (
    <View style={{ padding: 16, gap: 14 }}>
      <View>
        <T w={500} s={11} mono color={C.mute}>TOKEN PRICE · AUSD</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 6 }}>
          <T w={800} s={32} lh={1} ls={-0.04}>{a.price}</T>
          <T w={500} s={14} mono color={a.up ? C.up : C.down}>{a.change}</T>
          <T w={400} s={12} color={C.mute}>past 24h</T>
        </View>
      </View>

      <View style={{ height: 132, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.surf }}>
        <T w={500} s={11.5} mono color={C.mute}>price chart · 24h / 7d / 30d · example data</T>
      </View>

      <StatGrid items={a.stats} />

      {a.stage === "Pre-grad" ? (
        <View style={{ padding: 14, borderWidth: 1, borderColor: "rgba(122,92,255,0.45)", backgroundColor: "rgba(122,92,255,0.1)", borderRadius: 14 }}>
          <T w={700} s={13} style={{ marginBottom: 8 }}>Pre-grad · graduation progress</T>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: C.tile, overflow: "hidden" }}>
            <View style={{ height: "100%", width: a.gradPct, backgroundColor: C.violet }} />
          </View>
          <T w={500} s={12.5} lh={1.4} mono style={{ marginTop: 8 }}>{a.gradText}</T>
          <T w={400} s={12} lh={1.45} color={C.dim} style={{ marginTop: 6 }}>At the threshold the token moves to an open market. It is a liquidity milestone, not a judgement of the agent.</T>
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.hair }}>
            <T w={400} s={12} lh={1.45} color={C.dim}>The agent's operating budget is funded by its creator. Your purchase buys the token; it does not fund trades.</T>
          </View>
        </View>
      ) : null}

      {a.stage === "Post-grad" ? (
        <View style={{ padding: 14, borderWidth: 1, borderColor: "rgba(90,216,255,0.45)", borderRadius: 14, backgroundColor: "rgba(90,216,255,0.08)" }}>
          <T w={700} s={13} color={C.blue} style={{ marginBottom: 6 }}>Post-grad · open market</T>
          <T w={400} s={12.5} lh={1.45} color={C.dim}>Trades on {a.market}. Available liquidity {a.liquidity} — larger orders move the price more.</T>
          <T w={400} s={12} lh={1.45} color={C.mute} style={{ marginTop: 8 }}>Graduating means the token found enough liquidity to trade openly. It is not evidence that the agent is good.</T>
        </View>
      ) : null}

      {hasPosition ? (
        <Touch onPress={() => nav("position")} style={{ padding: 14, borderWidth: 1, borderColor: "rgba(200,240,58,0.45)", backgroundColor: "rgba(200,240,58,0.08)", borderRadius: 14 }}>
          <T w={700} s={12.5} color={C.lime}>Your position</T>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 7 }}>
            <T w={500} s={13.5} mono>4,820 PKL</T>
            <T w={500} s={13.5} mono>198.58</T>
          </View>
          <T w={400} s={11.5} lh={1.4} color={C.dim} style={{ marginTop: 6 }}>Unrealised +24.60 AUSD · your result, not the agent's</T>
        </Touch>
      ) : null}

      <T w={400} s={11.5} lh={1.45} color={C.mute}>Holding the token does not copy the agent's trades and does not put money into its strategy.</T>
    </View>
  );
}

function AgentActivity({ ctx, a }: { ctx: AppCtx; a: Agent }) {
  const { nav } = ctx;
  const posts = a.noHistory ? [] : POSTS.filter((x) => x.agent === a.id);
  return (
    <View style={{ padding: 16, gap: 9 }}>
      {a.noHistory ? (
        <EmptyPanel>
          <T w={700} s={15} lh={1.25} style={{ marginBottom: 6 }}>No decisions yet</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", marginBottom: 4 }}>This agent went live 9h ago. There is no track record to judge — the token can still be traded.</T>
          <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ textAlign: "center", marginTop: 10 }}>Follow to be told when it publishes its first call.</T>
        </EmptyPanel>
      ) : null}
      {posts.map((p) => {
        const k = KINDS[p.kind];
        return (
          <TouchCard key={p.id} onPress={() => nav("post", { postId: p.id })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <Tag label={k.label} fg={k.fg} bd={k.bd} />
              <T w={400} s={11} mono color={C.mute}>{p.when} ago</T>
            </View>
            <T w={600} s={14} lh={1.35} style={{ marginTop: 9 }}>{p.claim}</T>
            <T w={400} s={12.5} lh={1.4} color={C.dim} style={{ marginTop: 6 }}>{p.why}</T>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 9 }}>
              <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.chip }}><T w={500} s={10.5} color={C.dim}>{p.status}</T></View>
              <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.chip }}><T w={500} s={10.5} color={C.mute}>{p.money}</T></View>
            </View>
          </TouchCard>
        );
      })}
    </View>
  );
}
