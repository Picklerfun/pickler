"use client";

import { useReducer } from "react";
import styles from "../auth.module.css";
import type { AuthBoardData } from "../lib/board-data";
import { INITIAL, next, rail } from "../lib/flow";
import type { Step } from "../lib/flow";
import { AuthHeader } from "./auth-header";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { CodeStep } from "./steps/code-step";
import { HandleStep } from "./steps/handle-step";

/**
 * The form column and the board, with the flow machine driving which screen is in the column.
 *
 * Only the first three screens exist so far. The rest are named in plain text and nothing else:
 * a screen that pretends a passkey was made, or a wallet exists, is worse than an unfinished one,
 * because the next person to look cannot tell which of the two it is. Both routes are
 * `robots: { index: false, follow: false }` and unlinked from the landing, so nobody arrives here
 * by accident — but anyone who does should see at a glance that it is unfinished, not broken.
 */
const NOT_BUILT: Partial<Record<Step, string>> = {
  passkey: "Creating a passkey",
  wallet: "The wallet and its backup passkey",
  welcome: "The signed-in wallet",
  recover: "Approving a new device",
  approve: "Approving a new device",
  recovered: "Saving a passkey on this device",
};

export function PasskeyFlow({
  board,
  mode,
}: {
  board: AuthBoardData;
  /**
   * Which rail the route opens: `up` for /signup, `in` for /signin. It is the route's to give,
   * never defaulted here, because it is what decides whether a verified code goes on to the
   * handle screen or straight to welcome. `recover` is entered by `device_unknown`, never opened.
   */
  mode: "up" | "in";
}) {
  const [state, dispatch] = useReducer(next, { ...INITIAL, mode });
  const pending = NOT_BUILT[state.step];

  return (
    <>
      <AuthHeader view={state.mode === "in" ? "signin" : "signup"} />
      <main className={styles.signup}>
        <div className={styles.formColumn}>
          <ol className={styles.rail}>
            {rail(state).map((phase) => (
              <li
                key={phase.label}
                className={[
                  styles.railPhase,
                  phase.done ? styles.railDone : "",
                  phase.active ? styles.railActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={phase.active ? "step" : undefined}
              >
                <span className={styles.railBar} aria-hidden="true" />
                <span className={styles.railLabel}>{phase.label}</span>
              </li>
            ))}
          </ol>

          {state.step === "auth" && (
            <AccountStep
              mode={state.mode === "in" ? "in" : "up"}
              email={state.email}
              onMode={(chosen) => dispatch({ type: "mode_chosen", mode: chosen })}
              onSent={(email) => dispatch({ type: "code_sent", email })}
            />
          )}
          {state.step === "code" && (
            <CodeStep
              email={state.email}
              code={state.code}
              onCode={(code) => dispatch({ type: "code_changed", code })}
              onVerified={() => dispatch({ type: "code_verified" })}
              onChangeEmail={() => dispatch({ type: "change_email" })}
            />
          )}
          {state.step === "handle" && (
            <HandleStep
              handle={state.handle}
              onClaimed={(handle) => dispatch({ type: "handle_claimed", handle })}
            />
          )}
          {pending && (
            <p className={styles.notBuilt}>
              {`NOT BUILT YET\n\nStep: ${state.step}\n${pending}\n\n` +
                "Nothing was signed, created or saved."}
            </p>
          )}
        </div>

        <SpawnBoard board={board} />
      </main>
    </>
  );
}
