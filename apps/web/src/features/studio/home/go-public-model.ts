/**
 * GO PUBLIC's four steps on a draft's home, read from the draft itself. A draft made by the create
 * screen (studio-create-simplified-v1) already has its voice, its own wallet with the brief's caps
 * signed, and the AUSD it was funded with, so those steps are drawn done; only Connect X is still
 * to come. A draft from before keeps them open, marked Soon: nothing here can add them yet. Pure,
 * and pinned in `apps/web/test/studio-home-go-public.test.ts`.
 */
import type { Agent } from "../api";
import { VOICES } from "../new-agent/model";
import { MIN_FUNDED_AUSD } from "./status";

export interface GoPublicStep {
  key: "voice" | "x" | "wallet" | "fund";
  title: string;
  note: string;
  done: boolean;
  /** What the open step offers: "fund" opens the Wallets modal; "soon" is shut. Null when done. */
  action: "fund" | "soon" | null;
}

export function goPublicSteps(agent: Pick<Agent, "config" | "wallet">): GoPublicStep[] {
  const voice = VOICES.find((item) => item.key === agent.config.voice) ?? null;
  const wallet = agent.wallet;
  const funded = wallet !== null && wallet.balanceAusd >= MIN_FUNDED_AUSD;
  return [
    {
      key: "voice",
      title: "Voice",
      note: voice ? `${voice.name.toUpperCase()} · HOW EVERY TRADE READS` : "HOW EVERY TRADE READS",
      done: voice !== null,
      action: voice ? null : "soon",
    },
    { key: "x", title: "Connect X", note: "WHERE IT POSTS", done: false, action: "soon" },
    {
      key: "wallet",
      title: "Its wallet",
      note: wallet ? "CAPS FROM THE BRIEF · SIGNED" : "CAPS FROM THE BRIEF · PASSKEY",
      done: wallet !== null,
      action: wallet ? null : "soon",
    },
    {
      key: "fund",
      title: "Fund it",
      note: funded
        ? `${wallet.balanceAusd.toFixed(2)} AUSD IN IT`
        : wallet
          ? `AT LEAST ${MIN_FUNDED_AUSD} AUSD`
          : "AFTER ITS WALLET",
      done: funded,
      action: funded ? null : wallet ? "fund" : "soon",
    },
  ];
}
