import { useRoute } from "@react-navigation/native";
import { useState } from "react";
import { Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppCtx } from "../navigation/context";
import type { SigninParams } from "../navigation/routes";
import { ONBOARDING_SHEETS, type OnboardingSheet, onboardingExit } from "../onboarding";
import { saveOnboarded } from "../storage/onboarding";
import { Btn, Icon, T, Touch } from "../ui/primitives";
import { C } from "../ui/theme";

const LAST = ONBOARDING_SHEETS.length - 1;

/** Onboarding de 3 hojas sobre Markets desenfocado (spec mobile-light D21). Pantalla completa, sin `withPage`. */
export function OnboardingScreen() {
  const { finishSignin } = useAppCtx();
  const next = (useRoute().params as SigninParams)?.next;
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const sheet = ONBOARDING_SHEETS[step];
  const last = step === LAST;

  function close() {
    void saveOnboarded();
    finishSignin(onboardingExit(next));
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ opacity: 0.55, paddingTop: insets.top + 8, paddingHorizontal: 18, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Image source={require("../../assets/pickler-mark.png")} style={{ width: 24, height: 24 }} resizeMode="contain" />
          <T w={700} s={30} lh={1} ls={-0.045} display>MARKETS</T>
        </View>
        <View style={{ height: 46, borderRadius: 999, backgroundColor: C.ctl }} />
        <View style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => <View key={i} style={{ height: 150, borderRadius: 20, backgroundColor: C.card }} />)}
        </View>
      </View>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,13,26,0.32)" }} />
      {!last ? (
        <Touch
          onPress={() => setStep(LAST)}
          accessibilityLabel="onboarding-skip"
          style={{
            position: "absolute", right: 18, top: insets.top + 8, paddingVertical: 9, paddingHorizontal: 14,
            borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)",
          }}
        >
          <T w={500} s={11.5} lh={1} ls={0.06} mono color={C.dim}>SKIP</T>
        </Touch>
      ) : null}
      <View
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          paddingTop: 22, paddingHorizontal: 20, paddingBottom: insets.bottom + 18,
          borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.bg, gap: 18,
        }}
      >
        <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: C.empty, alignSelf: "center" }} />
        <Art sheet={sheet} />
        <View style={{ gap: 10 }}>
          <T w={500} s={10} lh={1} ls={0.12} mono color={C.vio}>{sheet.eyebrow}</T>
          <T w={700} s={30} lh={1} ls={-0.045} display>{sheet.title}</T>
          <T w={400} s={16} lh={1.45} color={C.dim}>{sheet.body}</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {ONBOARDING_SHEETS.map((_, i) => (
              <Touch key={i} onPress={() => setStep(i)} accessibilityLabel={`onboarding-dot-${i}`}>
                <View style={{ width: i === step ? 22 : 7, height: 5, borderRadius: 999, backgroundColor: i === step ? C.ink : C.dotOff }} />
              </Touch>
            ))}
          </View>
          <View style={{ marginLeft: "auto" }}>
            {last
              ? <Btn label={next ? "Continue" : "Go to markets"} variant="lime" onPress={close} accessibilityLabel="onboarding-cta" />
              : <Btn label="Next" variant="ink" onPress={() => setStep(step + 1)} accessibilityLabel="onboarding-cta" />}
          </View>
        </View>
      </View>
    </View>
  );
}

function Art({ sheet }: { sheet: OnboardingSheet }) {
  switch (sheet.art) {
    case "reads": return <ArtReads />;
    case "board": return <ArtBoard />;
    case "ways": return <ArtWays />;
  }
}

const READS_ROWS = [
  { label: "BTC +1.0% · 4H", dot: C.lime, value: "62%", fg: C.up },
  { label: "ETH −0.5% · 1H", dot: C.short, value: "34%", fg: C.down },
  { label: "MON +2.5% · 24H", dot: C.pending, value: "OPEN", fg: C.warn },
];

function ArtReads() {
  return (
    <View style={{ height: 150, borderRadius: 20, backgroundColor: C.card, alignItems: "center", justifyContent: "center", gap: 8 }}>
      {READS_ROWS.map((r) => (
        <View key={r.label} style={{ width: "78%", flexDirection: "row", alignItems: "center", gap: 8, padding: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.bg }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: r.dot }} />
          <T w={600} s={12.5} lh={1} style={{ flex: 1 }}>{r.label}</T>
          <T w={700} s={11} lh={1} mono color={r.fg}>{r.value}</T>
        </View>
      ))}
    </View>
  );
}

function ArtBoard() {
  return (
    <View style={{ height: 150, borderRadius: 20, backgroundColor: C.limeBg, alignItems: "center", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {[0, 1, 2].map((col) => (
          <View key={col} style={{ width: 44, gap: 4 }}>
            <View style={{ height: 30, borderRadius: 8, backgroundColor: col === 1 ? C.lime : C.bg, alignItems: "center", justifyContent: "center" }}>
              {col === 1 ? <T w={700} s={8} lh={1} mono color={C.ink}>LONG</T> : null}
            </View>
            <View style={{ height: 12, backgroundColor: C.ink }} />
            <View style={{ height: 30, borderRadius: 8, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
              {col === 1 ? <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.agentDot }} /> : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ArtWays() {
  return (
    <View style={{ height: 150, borderRadius: 20, backgroundColor: C.vioBg, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <View style={{ width: "80%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 999, backgroundColor: C.vio }}>
        <Icon name="ask" size={16} color={C.onInk} />
        <T w={600} s={14} lh={1} color={C.onInk}>Ask</T>
      </View>
      <View style={{ width: "80%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 999, backgroundColor: C.lime }}>
        <Icon name="arrow" size={16} color={C.ink} />
        <T w={600} s={14} lh={1} color={C.ink}>Trade</T>
      </View>
    </View>
  );
}
