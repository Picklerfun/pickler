import { useEffect, useState } from "react";
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { formatPrice } from "../perpl/orders";
import { levelFromRead, levelIsLive, sideFor } from "../reads/level";
import { cellLabel, formatRemaining } from "../reads/matrix";
import type { Read } from "../reads/types";
import { Avatar, Btn, Card, Page, Skeleton, T, Tag, Warn } from "../ui/primitives";
import { C } from "../ui/theme";
import { resolutionLine } from "./ask";

const STATE: Record<Read["status"], { label: string; fg: string; bg: string }> = {
  pending: { label: "READING", fg: C.faint, bg: C.ctl },
  open: { label: "OPEN", fg: C.warn, bg: C.warnBg },
  right: { label: "RIGHT", fg: C.limeInk, bg: C.limeBg14 },
  wrong: { label: "WRONG", fg: C.down, bg: C.downBg },
  void: { label: "VOID", fg: C.faint, bg: C.ctl },
  failed: { label: "FAILED", fg: C.faint, bg: C.ctl },
};

/** Read pagada (D14): pregunta y probabilidad, relojes, ITS READ, WHY, LIMITS. Sin BOOK IS AT ni SOURCES. */
export function ReadScreen({ S, reads, nav }: AppCtx) {
  const now = useNow(30_000);
  const listed = (reads.reads ?? []).find((r) => r.id === S.readId) ?? null;
  // Guardados por id (no por posición): navigateTo usa pop:true, así que un segundo push a "read" reutiliza
  // esta misma instancia con otro S.readId, y sin la llave el resultado/estado "missing" de la read anterior
  // podría renderizarse bajo el id nuevo mientras el fetch está en curso.
  const [fetched, setFetched] = useState<{ id: string; read: Read } | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const { fetchOne } = reads;
  useEffect(() => {
    const id = S.readId;
    if (listed || !id) return;
    let stale = false;
    void fetchOne(id).then((r) => {
      if (stale) return;
      if (r) setFetched({ id, read: r });
      else setMissing(id);
    });
    return () => { stale = true; };
  }, [listed, S.readId, fetchOne]);
  const read = listed ?? (fetched !== null && fetched.id === S.readId ? fetched.read : null);
  const isMissing = missing === S.readId;

  if (!read) {
    return isMissing
      ? <Page><Warn title="Couldn't open this read" body="It may belong to another wallet, or the reads service is unreachable." /></Page>
      : <Page gap={12}><Skeleton.Card lines={4} /><Skeleton.Card lines={2} /></Page>;
  }
  const agent = reads.agents?.find((a) => a.id === read.agentId);
  const name = agent?.name ?? read.agentId;
  const st = STATE[read.status];
  const line = resolutionLine(read, now);
  const trade = () => {
    const level = levelFromRead(read);
    nav("market", levelIsLive(level, now)
      ? { perpsMarketId: read.marketId, marketTab: "trade", tradeLevel: level, perpsSide: sideFor(read.levelBps) }
      : { perpsMarketId: read.marketId, marketTab: "trade" });
  };
  return (
    <Page gap={14}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar initials={name.slice(0, 2).toUpperCase()} size={40} />
        <View style={{ flex: 1 }}>
          <T w={600} s={17}>{name}</T>
          <Tag style={{ marginTop: 4 }}>READ · {read.creditsCharged} CREDIT · {read.symbol} {cellLabel(read)}</Tag>
        </View>
        <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: st.bg }}><Tag color={st.fg} s={9.5}>{st.label}</Tag></View>
      </View>
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: C.vio, gap: 10 }}>
        <Tag color={C.onVio}>THE QUESTION</Tag>
        <T w={600} s={17} lh={1.35} color={C.onInk}>{read.question}</T>
        <T w={700} s={64} lh={1} ls={-0.04} mono color={C.onInk}>{read.probability === null ? "—" : `${Math.round(read.probability * 100)}%`}</T>
        <Tag color={C.onVio}>ITS PROBABILITY · MARK {formatPrice(read.markAtRequest, read.priceDecimals)} AT REQUEST</Tag>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Card style={{ flex: 1 }} pad={14}><Tag>ASKED</Tag><T w={700} s={15} mono style={{ marginTop: 6 }}>{new Date(read.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</T></Card>
        <Card style={{ flex: 1 }} pad={14}><Tag>EVALUATES</Tag><T w={700} s={15} mono style={{ marginTop: 6 }}>{read.status === "open" ? formatRemaining(Date.parse(read.expiresAt) - now) : new Date(read.expiresAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</T></Card>
      </View>
      <T w={500} s={11.5} lh={1.4} mono color={line.fg}>{line.text}</T>
      {read.reasons ? (
        <View style={{ gap: 8 }}>
          <Tag>WHY</Tag>
          {read.reasons.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 7, height: 7, borderRadius: 999, marginTop: 7, backgroundColor: [C.vio, C.lime, C.pending][i % 3] }} />
              <T w={400} s={15} lh={1.45} style={{ flex: 1 }}>{r}</T>
            </View>
          ))}
        </View>
      ) : null}
      {read.limits ? (
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.warnBg, gap: 6 }}>
          <Tag color={C.warn}>LIMITS</Tag>
          <T w={400} s={14} lh={1.45} color={C.ink}>{read.limits}</T>
        </View>
      ) : null}
      {read.error ? <Warn title="The agent couldn't answer" body={read.error} /> : null}
      <Btn label="Trade this market" arrow onPress={trade} variant="lime" accessibilityLabel="trade-this-market" />
      <T w={400} s={12} lh={1.4} color={C.faint} style={{ textAlign: "center" }}>A read is not a trading permission.</T>
    </Page>
  );
}
