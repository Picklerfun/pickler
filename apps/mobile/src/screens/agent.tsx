import { useState } from "react";
import { View } from "react-native";
import Svg, { Line } from "react-native-svg";
import type { AppCtx } from "../ctx";
import { agentBlurb, hitRate } from "../reads/agentsCopy";
import { CALIBRATION_MIN, calibration, recordFor, type RecordFilter } from "../reads/calibration";
import { cellLabel, formatProbability } from "../reads/matrix";
import type { Read } from "../reads/types";
import { askMarketId } from "../store";
import { Btn, Card, Chip, EmptyPanel, InkBlock, Page, Reveal, Skeleton, T, Tag, Touch, TouchCard, Warn } from "../ui/primitives";
import { FooterBar, PageScroll } from "../ui/Page";
import { C } from "../ui/theme";

const FILTERS: readonly RecordFilter[] = ["all", "right", "wrong", "open"];
const FILTER_LABEL: Record<RecordFilter, string> = { all: "ALL", right: "RIGHT", wrong: "WRONG", open: "OPEN" };

const RECORD_TAG: Record<Read["status"], { label: string; fg: string }> = {
  pending: { label: "READING", fg: C.faint },
  open: { label: "OPEN", fg: C.warn },
  right: { label: "RIGHT", fg: C.up },
  wrong: { label: "WRONG", fg: C.down },
  void: { label: "VOID", fg: C.faint },
  failed: { label: "FAILED", fg: C.faint },
};
const RECORD_DOT: Record<Read["status"], string> = {
  pending: C.empty, open: C.pending, right: C.lime, wrong: C.short, void: C.empty, failed: C.empty,
};

/** Baldosa de stat del perfil: valor grande arriba, etiqueta mono abajo (spec mobile-light D16). */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, padding: 16, borderRadius: 18, backgroundColor: C.card }}>
      <T w={700} s={26} mono ls={-0.05}>{value}</T>
      <T w={500} s={9.5} mono ls={0.06} color={C.dim} style={{ marginTop: 8 }}>{label}</T>
    </View>
  );
}

function FilterPills({ value, onChange }: { value: RecordFilter; onChange: (f: RecordFilter) => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: C.ctl, borderRadius: 999, padding: 4, gap: 3 }}>
      {FILTERS.map((f) => {
        const on = f === value;
        return (
          <Touch key={f} onPress={() => onChange(f)} accessibilityLabel={`record-${f}`} style={{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? C.ink : "transparent" }}>
            <T w={500} s={11} mono ls={0.04} color={on ? C.onInk : C.dim}>{FILTER_LABEL[f]}</T>
          </Touch>
        );
      })}
    </View>
  );
}

/** CALIBRATION (D16): 5 buckets de probabilidad de TUS reads resueltas de este agente contra la diagonal prometida. */
function Calibration({ mine }: { mine: readonly Read[] }) {
  const buckets = calibration(mine);
  return (
    <InkBlock gap={14}>
      <Tag color={C.onInkDim}>CALIBRATION</Tag>
      <T w={400} s={14.5} lh={1.4} color={C.onInkSoft}>Bars are what happened with your reads. The dashed line is what it promised.</T>
      {buckets ? (
        <View style={{ height: 150 }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 118 }} pointerEvents="none">
            <Svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
              <Line x1={0} y1={88} x2={100} y2={8} stroke="#6E7490" strokeWidth={1.5} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
            </Svg>
          </View>
          <View style={{ height: 118, flexDirection: "row", alignItems: "flex-end", gap: 7 }}>
            {buckets.map((b, i) => (
              <View
                key={i}
                accessibilityLabel={`calib-${i}`}
                style={{
                  flex: 1,
                  height: Math.max(2, (b.actual ?? 0) * 108),
                  borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
                  backgroundColor: i < 2 ? C.vio : C.lime,
                }}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 9 }}>
            {buckets.map((b, i) => (
              <T key={i} w={500} s={9} mono color={C.onInkDim} style={{ flex: 1, textAlign: "center" }}>{`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}`}</T>
            ))}
          </View>
        </View>
      ) : (
        <T w={400} s={13} color={C.onInkDim}>{`Not enough resolved reads yet — ${CALIBRATION_MIN} needed.`}</T>
      )}
    </InkBlock>
  );
}

/** THE RECORD (D16): tus reads con este agente, filtradas en la app; cada fila abre la Read (D14). */
function RecordSection({ reads, agentId, nav }: { reads: AppCtx["reads"]; agentId: string; nav: AppCtx["nav"] }) {
  const [filter, setFilter] = useState<RecordFilter>("all");
  const rows = recordFor(reads.reads, agentId, filter);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T w={700} s={22} ls={-0.04} display>THE RECORD</T>
        <FilterPills value={filter} onChange={setFilter} />
      </View>
      {reads.session !== "ready" ? (
        <Warn title="Unlock to see your record" body="Your wallet signs once a day for Ask. No transaction, no gas.">
          <Btn label="Unlock with Face ID" onPress={() => { void reads.ensureSession(); }} variant="violet" py={11} accessibilityLabel="reads-unlock" />
        </Warn>
      ) : rows === null ? (
        <><Skeleton.Card lines={2} /><Skeleton.Card lines={2} /></>
      ) : rows.length === 0 ? (
        <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No reads with this agent yet.</T></EmptyPanel>
      ) : (
        <Reveal style={{ gap: 10 }}>
          {rows.map((r) => {
            const tag = RECORD_TAG[r.status];
            return (
              <TouchCard
                key={r.id}
                onPress={() => nav("read", { readId: r.id })}
                accessibilityLabel={`record-row-${r.id}`}
                radius={16}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 16 }}
              >
                <View style={{ width: 11, height: 11, borderRadius: 4, backgroundColor: RECORD_DOT[r.status] }} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <T w={600} s={15.5} numberOfLines={1}>{r.symbol} {cellLabel(r)}</T>
                  <T w={500} s={10.5} mono color={C.dim}>{r.probability === null ? "—" : formatProbability(r.probability)} · {r.creditsCharged} CREDIT</T>
                </View>
                <T w={700} s={13} mono color={tag.fg}>{tag.label}</T>
              </TouchCard>
            );
          })}
        </Reveal>
      )}
    </View>
  );
}

/** Perfil de agente (D16, C4 opción A): stats, ITS BEAT (la descripción de D15), CALIBRATION y THE RECORD con
 *  TUS reads (recortadas en la app de la ventana de 50 de reads-list, D26), y la barra fija "Ask". Sin backend
 *  nuevo. La tarjeta de Agents abre este perfil; Agents (lista) sigue pública, el perfil pide cuenta (D23). */
export function AgentScreen({ S, reads, perpl, nav, requireAccount }: AppCtx) {
  const a = reads.agents?.find((x) => x.id === S.agentId);

  if (reads.agents === null && !reads.agentsError) {
    return (
      <PageScroll screen="agent">
        <Page gap={12}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </Page>
      </PageScroll>
    );
  }
  if (reads.agentsError) {
    return (
      <PageScroll screen="agent">
        <Page gap={12}>
          <Warn title="Couldn't load agents" body={reads.agentsError}>
            <Chip label="Retry" onPress={() => { void reads.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agent" />
          </Warn>
        </Page>
      </PageScroll>
    );
  }
  if (!a) {
    return (
      <PageScroll screen="agent">
        <Page gap={12}>
          <Warn title="This agent isn't listed anymore" />
        </Page>
      </PageScroll>
    );
  }

  const mine = recordFor(reads.reads, a.id, "all") ?? [];

  return (
    <>
      <PageScroll screen="agent">
        <Page gap={12}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat value={hitRate(a.record)} label={`HIT · ${a.record.resolved} RESOLVED`} />
            <Stat value={a.record.brierAvg?.toFixed(2) ?? "—"} label={`BRIER · ${a.record.reads} READS`} />
          </View>
          <Card pad={18} gap={10}>
            <Tag>ITS BEAT</Tag>
            <T w={400} s={16} lh={1.4}>{agentBlurb(a.id)}</T>
          </Card>
          <Calibration mine={mine} />
          <RecordSection reads={reads} agentId={a.id} nav={nav} />
        </Page>
      </PageScroll>
      <FooterBar>
        <Btn
          label={`Ask · ${a.priceCredits} credit${a.priceCredits === 1 ? "" : "s"}`}
          icon="ask"
          variant="ask"
          onPress={() => requireAccount("market", { askAgentId: a.id, marketTab: "ask", perpsMarketId: askMarketId(S.perpsMarketId, perpl.context?.markets ?? []) })}
          accessibilityLabel="profile-ask"
        />
      </FooterBar>
    </>
  );
}
