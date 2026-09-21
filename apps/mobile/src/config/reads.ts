import Constants from "expo-constants";
import { READS_URL_DEFAULT } from "../reads/constants";

const extra = Constants.expoConfig?.extra ?? {};

/** URL del servicio de reads con override desde app.config.ts (`PICKLER_READS_URL`). */
export const READS_URL: string = typeof extra.readsUrl === "string" && extra.readsUrl !== "" ? extra.readsUrl : READS_URL_DEFAULT;

/** D10: "apns" = el servidor manda el push de resolución; "local" = fallback, la app programa una notificación local al vencer (P5). */
export const PUSH_MODE: "apns" | "local" = "apns";
