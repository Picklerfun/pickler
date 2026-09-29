import type { AgentRecord } from "./types";

// Una línea por agente para la tarjeta y el perfil (spec mobile-light D15). La persona (el prompt) no se expone.
const BLURBS: Record<string, string> = {
  jesus: "Swing trader on Monad perps. Prefers 4H–24H and fades moves past +2.5%.",
  drift: "Momentum. Leans with the 24h change.",
  anchor: "Mean reversion. Expects stretched moves to drift back.",
};

export const agentBlurb = (id: string): string => BLURBS[id] ?? "Reads Perpl markets on Monad.";

export const hitRate = (r: AgentRecord): string => (r.resolved === 0 ? "—" : `${Math.round((r.right / r.resolved) * 100)}%`);

// Iniciales para el Avatar del agente (tarjeta de Agents y, desde el item 9 de la ola final, la cabecera del perfil).
export const initials = (name: string): string => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
