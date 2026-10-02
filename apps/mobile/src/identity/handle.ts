// Reglas del username. Espejo de packages/api-schema/src/profiles.ts (que a su vez espeja a core); el servidor valida
// igual y manda: aquí sólo se le dice a la persona qué falta mientras escribe. __tests__/identity-handle.test.ts las ata. Puro.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 15;
const PATTERN = /^[a-z0-9_]+$/;

/** Handles que suplantarían al producto o al equipo. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "pickler", "pickle", "admin", "administrator", "support", "help", "team", "staff", "official", "security", "system",
  "root", "api", "studio", "board", "agents", "agent", "relayer", "moderator", "mod", "null", "undefined",
]);

export type HandleProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

/** Lo que se va a enviar: sin espacios alrededor, sin la @ que alguien pega, en minúsculas. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Qué le falta al handle mientras se escribe; null si nada. */
export function handleProblem(raw: string): HandleProblem | null {
  const handle = normalizeHandle(raw);
  if (handle.length < HANDLE_MIN) return "too_short";
  if (handle.length > HANDLE_MAX) return "too_long";
  if (!PATTERN.test(handle)) return "invalid_characters";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/** Dónde está el campo: vacío, con un problema local, consultando, sin poder consultar, tomado o libre. */
export type HandleState = "empty" | HandleProblem | "checking" | "unknown" | "taken" | "ok";

/** `available`: lo que respondió el servidor para este handle; undefined mientras no responde, null si no se pudo consultar. */
export function handleState(raw: string, available: boolean | null | undefined): HandleState {
  if (normalizeHandle(raw) === "") return "empty";
  const problem = handleProblem(raw);
  if (problem) return problem;
  if (available === undefined) return "checking";
  if (available === null) return "unknown";
  return available ? "ok" : "taken";
}

/** La línea bajo el campo, con las mismas palabras que la web. */
export function handleNote(state: HandleState, raw: string): string {
  switch (state) {
    case "empty": return `PICK ONE · ${HANDLE_MIN}–${HANDLE_MAX}`;
    case "invalid_characters": return "LETTERS, NUMBERS, UNDERSCORE ONLY";
    case "too_short": return `TOO SHORT · ${HANDLE_MIN} MIN`;
    case "too_long": return `TOO LONG · ${HANDLE_MAX} MAX`;
    case "reserved": return "THAT ONE IS SPOKEN FOR";
    case "taken": return `@${normalizeHandle(raw).toUpperCase()} IS TAKEN`;
    case "checking": return "CHECKING…";
    // Nunca «taken»: una consulta que falló no es una respuesta.
    case "unknown": return "COULD NOT CHECK · YOU CAN STILL CLAIM IT";
    case "ok": return "AVAILABLE";
  }
}

/** Se puede reclamar: sin problema local y sin que el servidor haya dicho que está tomado. */
export function claimable(state: HandleState): boolean {
  return state === "ok" || state === "unknown" || state === "checking";
}
