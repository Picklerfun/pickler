"use client";

import { useReducer } from "react";
import styles from "../auth.module.css";
import type { AuthBoardData } from "../lib/board-data";
import { INITIAL, next, rail } from "../lib/flow";
import type { Mode, Step } from "../lib/flow";
import { AuthHeader } from "./auth-header";
import { SpawnBoard } from "./spawn-board";
import { AccountStep } from "./steps/account-step";
import { CodeStep } from "./steps/code-step";

/**
 * The form column and the board, with the flow machine driving which screen is in the column.
 *
 * Only the first two screens exist so far. The rest say so rather than standing in for
 * something: a screen that pretends a passkey was made, or a wallet exists, is worse than an
 * empty one, because the next person to look cannot tell which of the two it is.
 */
const NOT_BUILT: Partial<Record<Step, string>> = {
  handle: "Picking a handle",
  passkey: "Creating a passkey",
  wallet: "The wallet and its backup passkey",
  welcome: "The signed-in wallet",
  recover: "Approving a new device",
  approve: "Approving a new device",
  recovered: "Saving a passkey on this device",
};

export function PasskeyFlow({ board, mode }: { board: AuthBoardData; mode: Mode }) {
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
          {pending && (
            <div className={styles.flowStep}>
              <h1 className={styles.flowTitle}>NOT BUILT YET</h1>
              <p className={`${styles.alert} ${styles.info}`}>
                {pending} is not implemented in this build. Nothing was signed, created or saved.
              </p>
            </div>
          )}
        </div>

        <SpawnBoard board={board} />
      </main>
    </>
  );
}
