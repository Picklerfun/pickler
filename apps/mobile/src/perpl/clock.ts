/**
 * Desfase entre el reloj del teléfono y el de Perpl (D19). Perpl rechaza firmas fuera de ±30 s;
 * los dos `3401` del iPhone de Jesús (audit mobile-polish) eran esto, no geobloqueo.
 */
export const CLOCK_SKEW_MAX_MS = 20_000; // margen bajo los ±30 s del servidor

/** serverTime − now; null si el servidor no mandó `Date`. */
export function clockSkewMs(serverTime: number | null, now: number): number | null {
  return serverTime === null ? null : serverTime - now;
}

export function describeClockSkew(skewMs: number | null): { title: string; body: string } | null {
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_MAX_MS) return null;
  return {
    title: `Your phone's clock is off by ${Math.floor(Math.abs(skewMs) / 1000)} s.`,
    body: "Perpl rejects signatures more than 30 s off — turn on Set automatically in Settings › General › Date & Time.",
  };
}

export const KEY_REJECTED_COPY = "Check the phone clock first; if it is right, Perpl may not be available in your region.";
