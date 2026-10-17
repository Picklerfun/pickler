import { Client, type ClientConfig, type Pool } from "pg";

const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

export interface PerpsLabConnectionDiagnostic {
  version: 1;
  connectionId: number;
  workload: "execution" | "report";
  phase:
    | "created"
    | "socket-connected"
    | "authentication-observed"
    | "protocol-ready"
    | "transport-error"
    | "closed";
  at: number;
  elapsedMs: number;
  backendPid: number | null;
  driverCode: string | null;
}

/** Installed pg lifecycle signals only; no addresses, auth payloads, SQL or error messages. */
export function observeLocalPerpsConnections(
  pool: Pool,
  workload: "execution" | "report",
  notify: (value: PerpsLabConnectionDiagnostic) => void,
) {
  const Base = Reflect.get(pool, "Client") as typeof Client;
  let sequence = 0;
  class ObservedClient extends Base {
    constructor(config?: ClientConfig) {
      super(config);
      const connectionId = ++sequence;
      const started = performance.now();
      const emit = (phase: PerpsLabConnectionDiagnostic["phase"], error?: unknown) => {
        try {
          const pid: unknown = Reflect.get(this, "processID");
          const supplied =
            error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
          notify({
            version: 1,
            connectionId,
            workload,
            phase,
            at: Date.now(),
            elapsedMs: Math.max(0, performance.now() - started),
            backendPid:
              typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
            driverCode:
              typeof supplied === "string" &&
              (/^[A-Z0-9]{5}$/.test(supplied) || transportCodes.has(supplied))
                ? supplied
                : null,
          });
        } catch {
          /* Diagnostics cannot change driver behavior, including failing metadata access. */
        }
      };
      emit("created");
      const connection = Reflect.get(this, "connection") as {
        once(name: string, listener: (...args: unknown[]) => void): unknown;
        on(name: string, listener: (...args: unknown[]) => void): unknown;
      };
      connection.once("connect", () => emit("socket-connected"));
      let authenticated = false;
      const auth = () => {
        if (!authenticated) {
          authenticated = true;
          emit("authentication-observed");
        }
      };
      for (const event of [
        "authenticationCleartextPassword",
        "authenticationMD5Password",
        "authenticationSASL",
        "authenticationOk",
      ]) {
        connection.once(event, auth);
      }
      connection.once("readyForQuery", () => emit("protocol-ready"));
      connection.on("error", (error) => emit("transport-error", error));
      this.once("end", () => emit("closed"));
    }
  }
  Reflect.set(pool, "Client", ObservedClient);
}
