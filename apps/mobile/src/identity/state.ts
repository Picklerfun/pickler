// Qué se sabe de la cuenta de esta wallet. Puro.
//
// El username es obligatorio (decisión del owner, 2026-10-02; igual que en la web): una cuenta que se sabe sin username
// no usa la app hasta elegirlo o cerrar sesión. «Se sabe» es la clave: sólo la respuesta del servidor (404 con sesión)
// retiene a alguien. Si la API no está configurada, no responde o la wallet está bloqueada, nadie queda fuera.
export type Identity =
  | { status: "off" } // sin PICKLER_API_URL: la app se comporta como antes de tener cuenta
  | { status: "unknown" } // aún no se pregunta: sin wallet, o bloqueada y sin username guardado
  | { status: "checking" }
  | { status: "none" } // con sesión y sin username: la pantalla obligatoria
  | { status: "has"; handle: string }
  | { status: "unreachable" }; // no se pudo saber: no retiene a nadie

/** La pantalla de username tapa la app. */
export const gateOpen = (identity: Identity): boolean => identity.status === "none";

/** Lo que puede estar pasando debajo cuando la cuenta resulta no tener username. */
export type Foreground = {
  treasuryBusy: boolean;
  readPending: boolean;
  /** Habilitar trading en Perpl: approve, cuenta con depósito y key, varios pasos con dinero. */
  perplOnboarding: boolean;
};

/**
 * La pantalla no cae encima de una operación en curso: quien desbloqueó para retirar, pedir una read o habilitar
 * trading ve primero cómo termina. Todas desbloquean la wallet, y desbloquear es lo que dispara la consulta.
 */
export const appQuiet = (f: Foreground): boolean => !f.treasuryBusy && !f.readPending && !f.perplOnboarding;

/**
 * Perpl está habilitando trading: `onboarding` sin error. Detenido en un error (sin MON, tx rechazada) ya no corre
 * nada —la persona ve la pantalla de reintento— y la cuenta sí puede pedir su username.
 */
export const perplOnboardingActive = (state: { status: string; error?: string }): boolean =>
  state.status === "onboarding" && !state.error;

/** Se muestra si la cuenta no tiene username y (ya se mostraba, o no hay nada en curso). Una vez abierta se queda. */
export const gateShows = (identity: Identity, shownBefore: boolean, quiet: boolean): boolean =>
  gateOpen(identity) && (shownBefore || quiet);

/**
 * Lo guardado en el dispositivo: el username de una dirección, en una API. No es secreto. La API va incluida porque una
 * cuenta de staging no es la de producción: quien cambia de build vuelve a ser preguntado.
 */
export type StoredIdentity = { address: string; handle: string; api: string };

export function serializeIdentity(s: StoredIdentity): string {
  return JSON.stringify({ address: s.address.toLowerCase(), handle: s.handle, api: s.api });
}

export function parseIdentity(raw: string): StoredIdentity | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (value === null || typeof value !== "object") return undefined;
  const { address, handle, api } = value as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/.test(address)) return undefined;
  if (typeof handle !== "string" || handle === "") return undefined;
  if (typeof api !== "string" || api === "") return undefined;
  return { address, handle, api };
}

/** El username guardado sólo vale para su dirección y para la API que lo dijo. */
export function identityFor(s: StoredIdentity | undefined, address: string | null, api: string | null): StoredIdentity | undefined {
  return s && address !== null && s.address === address.toLowerCase() && s.api === api ? s : undefined;
}
