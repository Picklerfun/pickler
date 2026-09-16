import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import { money, pill, quoteFor, sellQuoteFor } from "../mock/helpers";
import type { Phase } from "../store";
import { KV, Segmented, T, Touch } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

type Notice = { title: string; body: string; bd: string; bg: string; fg: string };
type Result = { title: string; glyph: string; fg: string; bd: string; bg: string; body: string; rows: { label: string; value: string }[] };
type Action = { label: string; bg: string; fg: string; bd: string; disabled?: boolean; go: () => void };
type Row = { label: string; value: string; fg: string };

export function TradeScreen(ctx: AppCtx) {
  const { S, set, nav, agent: a, balance } = ctx;
  const buying = S.mode === "buy";
  const holds = ctx.tradeHolds;
  const p = S.phase;
  const q = quoteFor(a, S.amount);
  const sq = sellQuoteFor(a, S.sellPct);

  const notice: Notice | undefined = ({
    insufficient: { title: "Not enough AUSD", body: "You have " + money(balance) + " AUSD and this order needs " + money(q.gross) + ". Deposit and come back — the agent and the amount are kept.", bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)", fg: C.warn },
    expired: { title: "The quote changed", body: "The price moved past your 1% slippage while you were reading. Nothing was sent. Refresh to see the new numbers.", bd: C.hair2, bg: C.surf2, fg: C.ink },
    sent: { title: "Sent, waiting on the network", body: "Your order is being processed. You can leave this screen — we will tell you when it settles.", bd: "rgba(122,92,255,0.5)", bg: "rgba(122,92,255,0.1)", fg: C.violetInk },
    unknown: { title: "Still verifying", body: "We have not been able to confirm this order yet. It may still succeed. Do not send it again — we will update this screen either way.", bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)", fg: C.warn },
  } as Partial<Record<Phase, Notice>>)[p];

  const result: Result | null = p === "done"
    ? { title: "Purchase complete", glyph: "✓", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)", body: "Settled at 09:42. These are the real amounts, not the estimate.", rows: [{ label: "Paid", value: "250.00 AUSD" }, { label: "Received", value: "5,998.2 " + a.tickerBare }, { label: "Average price", value: "0.0413 AUSD" }, { label: "Reference", value: "0x4d1a…77c" }] }
    : p === "failed"
      ? { title: "Order failed", glyph: "×", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)", body: "Nothing left your balance. The pool did not have enough liquidity at your price. Try a smaller amount or a wider slippage.", rows: [{ label: "Charged", value: "0.00 AUSD" }, { label: "Reference", value: "0x91bb…20e" }] }
      : null;

  const actions: Action[] = ({
    quoting: [{ label: "Getting the price…", bg: C.chip, fg: C.mute, bd: C.hair, disabled: true, go: () => {} }],
    quote: [{ label: buying ? "Review purchase" : "Review sale", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => set({ phase: "confirm" }) }],
    insufficient: [
      { label: "Deposit AUSD", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => nav("deposit", { resume: true }) },
      { label: "Change amount", bg: "transparent", fg: C.ink, bd: C.hair2, go: () => set({ amount: 100 }) },
    ],
    expired: [{ label: "Refresh quote", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => set({ phase: "quoting" }) }],
    confirm: [
      { label: buying ? "Confirm purchase" : "Confirm sale", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => set({ phase: "sent" }) },
      { label: "Back to the amount", bg: "transparent", fg: C.ink, bd: C.hair2, go: () => set({ phase: "quote" }) },
    ],
    sent: [
      { label: "Processing…", bg: C.chip, fg: C.mute, bd: C.hair, disabled: true, go: () => {} },
      { label: "Back to the market", bg: "transparent", fg: C.ink, bd: C.hair2, go: () => nav("market") },
    ],
    done: [
      { label: "See your position", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => nav("position", { mockHolder: true }) },
      { label: "Receipt", bg: "transparent", fg: C.ink, bd: C.hair2, go: () => nav("wallet") },
    ],
    failed: [{ label: "Try again", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => set({ phase: "quoting" }) }],
    unknown: [
      { label: "Checking…", bg: C.chip, fg: C.mute, bd: C.hair, disabled: true, go: () => {} },
      { label: "Open the movement", bg: "transparent", fg: C.ink, bd: C.hair2, go: () => nav("wallet") },
    ],
  } as Record<Phase, Action[]>)[p];

  const quoteRows: Row[] = p === "quoting"
    ? [{ label: "Fees, impact and amount received", value: "calculating…", fg: C.mute }]
    : buying
      ? [
        { label: "You pay", value: money(q.gross) + " AUSD", fg: C.ink },
        { label: "Platform fee · 1%", value: "−" + money(q.fee) + " AUSD", fg: C.dim },
        { label: "Network fee · example", value: "−" + money(q.network) + " AUSD", fg: C.dim },
        { label: "Price impact", value: "0.42%", fg: C.dim },
        { label: "Max slippage allowed", value: "1.0%", fg: C.dim },
        { label: "You receive · estimated", value: "≈ " + money(q.tokens, 1) + " " + a.tickerBare, fg: C.lime },
      ]
      : [
        { label: "You sell", value: money(sq.qty, 1) + " " + a.tickerBare, fg: C.ink },
        { label: "At", value: a.price + " AUSD", fg: C.dim },
        { label: "Platform fee · 1%", value: "−" + money(sq.fee) + " AUSD", fg: C.dim },
        { label: "Network fee · example", value: "−" + money(sq.network) + " AUSD", fg: C.dim },
        { label: "You receive · estimated", value: "≈ " + money(sq.net) + " AUSD", fg: C.lime },
      ];

  const quickAmounts = buying
    ? [50, 100, 250, 500].map((v) => ({ label: "" + v, ...pill(S.amount === v, C.lime), go: () => set({ amount: v, phase: balance < v ? "insufficient" : "quote" }) }))
    : [25, 50, 75, 100].map((v) => ({ label: v === 100 ? "All" : v + "%", ...pill(S.sellPct === v, C.lime), go: () => set({ sellPct: v }) }));

  const quoteAge = p === "quoting" ? "loading" : p === "expired" ? "expired" : "updated 3s ago";
  const showQuote = ["quoting", "quote", "expired", "confirm", "insufficient"].includes(p);
  const amountBd = p === "insufficient" ? "rgba(245,195,91,0.6)" : C.lime;
  const amountFg = p === "insufficient" ? C.warn : C.ink;
  const balanceFg = p === "insufficient" ? C.warn : C.dim;

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <Segmented options={([["buy", "Buy"], ["sell", "Sell"]] as const).map(([k, label]) => {
        const on = S.mode === k;
        const off = k === "sell" && !holds;
        return { label, strong: true, bg: on ? C.ink : "transparent", fg: on ? C.onInk : off ? C.disabled : C.dim, disabled: off, onPress: off ? undefined : () => set({ mode: k }) };
      })} />
      {!holds ? <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginTop: -6, marginHorizontal: 2 }}>Sell is off because you hold 0 {a.tickerBare}. It turns on as soon as a purchase settles.</T> : null}

      {S.resume ? (
        <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(122,92,255,0.5)", backgroundColor: "rgba(122,92,255,0.12)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4}>Picking up where you left off</T>
          <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 3 }}>250.00 AUSD of {a.tickerBare} ({a.name})</T>
        </View>
      ) : null}

      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, flexDirection: "row", gap: 11, alignItems: "center" }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" }}>
          <T w={800} s={14} color={C.dim}>{a.initial}</T>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w={700} s={14} lh={1.2}>{a.name} · {a.tickerBare}</T>
          <T w={400} s={11.5} lh={1.2} color={C.mute} style={{ marginTop: 3 }}>1 {a.tickerBare} = {a.price} AUSD · quote {quoteAge}</T>
        </View>
      </View>

      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: amountBd, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>{buying ? "Amount to spend" : "Tokens to sell"}</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T w={800} s={30} lh={1} ls={-0.03} color={amountFg}>{buying ? money(S.amount) : money(sq.qty, 1)}</T>
          <T w={500} s={14} mono color={C.mute}>{buying ? "AUSD" : a.tickerBare}</T>
        </View>
        <T w={400} s={12} lh={1.4} color={balanceFg} style={{ marginTop: 10 }}>
          {buying ? money(balance) + " AUSD available" + (balance === 0 ? " — nothing deposited yet" : "") : "4,820 " + a.tickerBare + " held · 4,820 available to sell"}
        </T>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 11 }}>
          {quickAmounts.map((qa, i) => (
            <Touch key={i} onPress={qa.go} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 999, borderWidth: 1, borderColor: qa.bd, backgroundColor: qa.bg, alignItems: "center" }}>
              <T w={600} s={12} color={qa.fg}>{qa.label}</T>
            </Touch>
          ))}
        </View>
      </View>

      {showQuote ? (
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T w={700} s={12.5}>{p === "quoting" ? "Getting a quote" : "Quote"}</T>
            <T w={400} s={11} mono color={p === "expired" ? C.warn : C.mute}>{p === "quoting" ? "loading…" : p === "expired" ? "expired" : "valid 12s"}</T>
          </View>
          {quoteRows.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
        </View>
      ) : null}

      {notice ? (
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: notice.bd, backgroundColor: notice.bg, borderRadius: 14 }}>
          <T w={700} s={13} lh={1.35} color={notice.fg}>{notice.title}</T>
          <T w={400} s={12.5} lh={1.45} color={C.dim} style={{ marginTop: 5 }}>{notice.body}</T>
        </View>
      ) : null}

      {p === "confirm" ? (
        <View style={{ padding: 14, borderWidth: 1, borderColor: C.hair2, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={700} s={13} style={{ marginBottom: 10 }}>Before you confirm</T>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, padding: 11, borderRadius: 11, backgroundColor: C.surf, borderWidth: 1, borderColor: C.hairSoft }}>
              <T w={400} s={11} color={C.mute}>You give</T>
              <T w={500} s={14} lh={1.25} mono style={{ marginTop: 6 }}>{buying ? money(q.gross) + " AUSD" : money(sq.qty, 1) + " " + a.tickerBare}</T>
            </View>
            <View style={{ flex: 1, padding: 11, borderRadius: 11, backgroundColor: C.surf, borderWidth: 1, borderColor: "rgba(200,240,58,0.4)" }}>
              <T w={400} s={11} color={C.mute}>You get</T>
              <T w={500} s={14} lh={1.25} mono color={C.lime} style={{ marginTop: 6 }}>{buying ? "≈ " + money(q.tokens, 1) + " " + a.tickerBare : "≈ " + money(sq.net) + " AUSD"}</T>
            </View>
          </View>
          <T w={400} s={11.5} lh={1.45} color={C.mute} style={{ marginTop: 10 }}>Final amounts can differ by up to the slippage you allowed. You are buying the token, not funding the agent.</T>
        </View>
      ) : null}

      {result ? (
        <View style={{ padding: 18, paddingHorizontal: 15, borderWidth: 1, borderColor: result.bd, backgroundColor: result.bg, borderRadius: 16, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <View style={{ width: 26, height: 26, borderRadius: 999, borderWidth: 1.5, borderColor: result.fg, alignItems: "center", justifyContent: "center" }}>
              <T w={700} s={13} color={result.fg}>{result.glyph}</T>
            </View>
            <T w={800} s={16} lh={1.2} color={result.fg}>{result.title}</T>
          </View>
          <T w={400} s={13} lh={1.5} color={C.dim}>{result.body}</T>
          {result.rows.map((r, i) => <KV key={i} label={r.label} value={r.value} />)}
        </View>
      ) : null}

      <View style={{ gap: 8, marginTop: 2 }}>
        {actions.map((b, i) => (
          <Touch key={i} onPress={b.go} disabled={b.disabled} style={{ paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: b.bd, backgroundColor: b.bg, alignItems: "center" }}>
            <T w={700} s={14.5} color={b.fg}>{b.label}</T>
          </Touch>
        ))}
        <T w={400} s={11} lh={1.45} color={C.mute} style={{ margin: 2, textAlign: "center" }}>
          {p === "unknown" ? "Sending again could buy twice. We will resolve this state for you." : "You are trading the token. You are not funding the agent or copying its trades."}
        </T>
      </View>
    </View>
  );
}

export function SigninScreen({ S, agent: a, onWallet, finishSignin }: AppCtx) {
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [error, setError] = useState("");
  const off = busy !== null;

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setError("");
    try {
      const wallet = kind === "create" ? await createAccount() : await signIn();
      onWallet(wallet);
      finishSignin();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ padding: 20, paddingHorizontal: 16, gap: 14 }}>
      {S.resume ? (
        <View style={{ padding: 13, borderWidth: 1, borderColor: "rgba(122,92,255,0.5)", backgroundColor: "rgba(122,92,255,0.12)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4}>Your purchase is being held</T>
          <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 3 }}>250.00 AUSD of {a.tickerBare} ({a.name}) — you come straight back here after this step.</T>
        </View>
      ) : null}
      <T w={400} s={13.5} lh={1.5} color={C.dim}>You need a wallet to hold AUSD and agent tokens. Reading the market, following agents and asking questions never require one.</T>
      <Touch onPress={() => run("create")} disabled={off} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center", opacity: off && busy !== "create" ? 0.5 : 1 }}>
        {busy === "create" ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={14.5} color={C.onLime}>Create a wallet</T>}
      </Touch>
      <Touch onPress={() => run("signin")} disabled={off} style={{ paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: C.hair2, alignItems: "center", opacity: off && busy !== "signin" ? 0.5 : 1 }}>
        {busy === "signin" ? <ActivityIndicator color={C.ink} /> : <T w={700} s={14.5}>I already have one</T>}
      </Touch>
      {error ? <T w={400} s={12.5} lh={1.4} color={C.down}>{error}</T> : null}
    </View>
  );
}
