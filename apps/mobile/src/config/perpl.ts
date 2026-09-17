import Constants from "expo-constants";
import { PERPL_REST, PERPL_WS } from "../perpl/config";

const extra = Constants.expoConfig?.extra ?? {};
const rest = typeof extra.perplRest === "string" && extra.perplRest !== "" ? extra.perplRest : PERPL_REST;
const ws = typeof extra.perplWs === "string" && extra.perplWs !== "" ? extra.perplWs : PERPL_WS;

/** URLs de Perpl con override desde app.config.ts (mainnet después). */
export const PERPL_URLS = { rest, ws } as const;
